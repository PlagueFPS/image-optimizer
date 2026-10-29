use crate::{
    plan::{Format, PlannedOutput, reject_symlinks},
    request::{Args, Transform},
};
use anyhow::{Context, Result, ensure};
use libvips::{VipsApp, VipsImage, ops};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::PathBuf,
};

#[derive(Serialize)]
pub struct Output {
    pub input: PathBuf,
    pub output: PathBuf,
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub bytes: Option<u64>,
    pub requested_width: Option<u32>,
}

pub struct Backend {
    app: VipsApp,
}
impl Backend {
    pub fn new(cpu: u16) -> Result<Self> {
        let app = VipsApp::new("image-optimizer", false)?;
        app.concurrency_set(cpu.into());
        app.cache_set_max(0);
        app.cache_set_max_mem(0);
        app.cache_set_max_files(0);
        Ok(Self { app })
    }
    pub fn process(&self, job: &PlannedOutput, args: &Args) -> Result<Output> {
        self.app.error_clear();
        self.convert(job, args).map_err(|e| {
            let detail = self.app.error_buffer().unwrap_or("").trim().to_string();
            if detail.is_empty() {
                e
            } else {
                e.context(detail)
            }
        })
    }
    fn convert(&self, job: &PlannedOutput, args: &Args) -> Result<Output> {
        reject_symlinks(&job.input)?;
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&job.input)?;
        ensure!(
            file.metadata()?.is_file(),
            "input must remain a regular file"
        );
        validate_container(&mut file, job.source_format)?;
        let source = format!("/proc/self/fd/{}", file.as_raw_fd());
        let header = VipsImage::new_from_file_access(&source, ops::Access::Sequential, false)?;
        ensure!(
            header.get_n_pages() == 1,
            "animated or multipage input is unsupported"
        );
        let loader = header.get_as_string("vips-loader")?;
        let expected = match job.source_format {
            Format::Jpeg => "jpeg",
            Format::Png => "png",
            Format::Avif => "heif",
            Format::Svg => "svg",
            Format::Webp => unreachable!(),
        };
        ensure!(
            loader.contains(expected),
            "input contents do not match its extension"
        );
        let (mut width, mut height) = (header.get_width(), header.get_height());
        ensure!(
            width > 0 && height > 0 && width as u64 * height as u64 <= args.max_pixels,
            "source exceeds --max-pixels or has invalid dimensions"
        );
        if header.get_orientation() >= 5 {
            std::mem::swap(&mut width, &mut height);
        }
        drop(header);
        let (w, h, size, requested_width) = match job.transform {
            Transform::Original => (width, height, ops::Size::Down, None),
            Transform::Fit {
                width: w,
                height: h,
                upscale,
            } => (
                w.map(|v| v as i32).unwrap_or(100_000_000),
                h.map(|v| v as i32).unwrap_or(100_000_000),
                if upscale {
                    ops::Size::Both
                } else {
                    ops::Size::Down
                },
                w,
            ),
        };
        let scale = (w as f64 / width as f64).min(h as f64 / height as f64);
        let scale = if matches!(size, ops::Size::Down) {
            scale.min(1.0)
        } else {
            scale
        };
        ensure!(
            (width as f64 * scale).ceil() * (height as f64 * scale).ceil()
                <= args.max_pixels as f64,
            "output exceeds --max-pixels"
        );
        let image = ops::thumbnail_with_opts(
            &source,
            w,
            &ops::ThumbnailOptions {
                height: h,
                size,
                output_profile: None,
                fail_on: ops::FailOn::Warning,
                ..Default::default()
            },
        )?;
        let mut result = Output {
            input: job.input.clone(),
            output: job.output.clone(),
            format: job.format,
            width: image.get_width() as u32,
            height: image.get_height() as u32,
            bytes: None,
            requested_width,
        };
        if args.dry_run {
            return Ok(result);
        }
        reject_symlinks(&job.output)?;
        let parent = job.output.parent().context("output has no parent")?;
        fs::create_dir_all(parent)?;
        reject_symlinks(parent)?;
        let temp = tempfile::Builder::new()
            .prefix(".image-optimizer-")
            .tempfile_in(parent)?;
        let filename = format!("/proc/self/fd/{}", temp.as_file().as_raw_fd());
        let q = args.quality.into();
        match job.format {
            Format::Webp => ops::webpsave_with_opts(
                &image,
                &filename,
                &ops::WebpsaveOptions {
                    q,
                    effort: args.effort.into(),
                    keep: ops::ForeignKeep::None,
                    profile: None,
                    ..Default::default()
                },
            )?,
            Format::Jpeg => ops::jpegsave_with_opts(
                &image,
                &filename,
                &ops::JpegsaveOptions {
                    q,
                    optimize_coding: true,
                    keep: ops::ForeignKeep::None,
                    profile: None,
                    ..Default::default()
                },
            )?,
            Format::Png => ops::pngsave_with_opts(
                &image,
                &filename,
                &ops::PngsaveOptions {
                    compression: args.effort.into(),
                    filter: ops::ForeignPngFilter::All,
                    keep: ops::ForeignKeep::None,
                    profile: None,
                    ..Default::default()
                },
            )?,
            Format::Avif => ops::heifsave_with_opts(
                &image,
                &filename,
                &ops::HeifsaveOptions {
                    q,
                    effort: args.effort.into(),
                    bitdepth: 8,
                    compression: ops::ForeignHeifCompression::Av1,
                    keep: ops::ForeignKeep::None,
                    profile: None,
                    ..Default::default()
                },
            )?,
            Format::Svg => {
                file.rewind()?;
                let mut xml = String::new();
                file.read_to_string(&mut xml)?;
                let document = roxmltree::Document::parse(&xml)?;
                let root = document.root_element();
                let mut edits = Vec::new();
                let mut added = String::new();
                for (name, value) in [
                    ("width", result.width.to_string()),
                    ("height", result.height.to_string()),
                    ("viewBox", format!("0 0 {width} {height}")),
                ] {
                    if let Some(attribute) = root
                        .attributes()
                        .find(|a| a.name() == name && a.namespace().is_none())
                    {
                        if name != "viewBox" {
                            edits.push((attribute.range_value(), value));
                        }
                    } else {
                        added.push_str(&format!(" {name}=\"{value}\""));
                    }
                }
                let start = root.range().start;
                let name_end = start
                    + 1
                    + xml[start + 1..]
                        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
                        .context("invalid SVG root")?;
                edits.push((name_end..name_end, added));
                drop(document);
                edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
                for (range, value) in edits {
                    xml.replace_range(range, &value);
                }
                fs::write(&filename, xml)?;
            }
        }
        result.bytes = Some(temp.as_file().metadata()?.len());
        temp.as_file().sync_all()?;
        reject_symlinks(&job.output)?;
        if args.overwrite {
            temp.persist(&job.output)?;
        } else {
            temp.persist_noclobber(&job.output)?;
        }
        Ok(result)
    }
}

fn validate_container(file: &mut File, format: Format) -> Result<()> {
    if format == Format::Svg {
        ensure!(
            file.metadata()?.len() <= 4 * 1024 * 1024,
            "SVG exceeds 4 MiB"
        );
        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        ensure!(
            !xml.contains("<!DOCTYPE") && !xml.contains("<?xml-stylesheet"),
            "SVG document types and external stylesheets are unsupported"
        );
        let document = roxmltree::Document::parse(&xml)?;
        ensure!(
            document.root_element().tag_name().name() == "svg",
            "expected SVG root"
        );
        for node in document.descendants().filter(|n| n.is_element()) {
            ensure!(
                !matches!(
                    node.tag_name().name(),
                    "script"
                        | "foreignObject"
                        | "style"
                        | "animate"
                        | "animateMotion"
                        | "animateTransform"
                        | "set"
                        | "discard"
                        | "image"
                        | "feImage"
                ),
                "SVG scripts, stylesheets, images, and animation are unsupported"
            );
            for attr in node.attributes() {
                let value = attr.value().trim();
                ensure!(
                    !attr.name().starts_with("on")
                        && attr.name() != "style"
                        && attr.name() != "base",
                    "SVG event handlers, inline CSS, and base URLs are unsupported"
                );
                if attr.name() == "href" {
                    ensure!(
                        value.starts_with('#'),
                        "SVG external references are unsupported"
                    );
                }
                let lowercase = value.to_ascii_lowercase();
                ensure!(
                    !value.contains('\\'),
                    "SVG escaped attribute values are unsupported"
                );
                if lowercase.contains("url(") {
                    ensure!(
                        lowercase.starts_with("url(#")
                            && value.ends_with(')')
                            && value[5..value.len() - 1]
                                .chars()
                                .all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c)),
                        "SVG external URLs are unsupported"
                    );
                }
            }
        }
    } else if format == Format::Png {
        let mut signature = [0u8; 8];
        file.read_exact(&mut signature)?;
        ensure!(&signature == b"\x89PNG\r\n\x1a\n", "invalid PNG signature");
        loop {
            let mut chunk = [0u8; 8];
            file.read_exact(&mut chunk)
                .context("truncated PNG chunks")?;
            ensure!(&chunk[4..] != b"acTL", "animated PNG is unsupported");
            if &chunk[4..] == b"IEND" {
                break;
            }
            let length = u32::from_be_bytes(chunk[..4].try_into().unwrap()) as u64;
            let end = file
                .stream_position()?
                .checked_add(length + 4)
                .context("PNG length overflow")?;
            ensure!(end <= file.metadata()?.len(), "truncated PNG chunk");
            file.seek(SeekFrom::Start(end))?;
        }
    } else if format == Format::Avif {
        let mut head = [0u8; 12];
        file.read_exact(&mut head)?;
        ensure!(&head[4..8] == b"ftyp", "invalid AVIF file type");
        let length = u32::from_be_bytes(head[..4].try_into().unwrap()) as usize;
        ensure!(
            (16..=4096).contains(&length),
            "unsupported AVIF file type box"
        );
        let mut brands = vec![0; length - 12];
        file.read_exact(&mut brands)?;
        ensure!(
            &head[8..12] == b"avif" || brands.chunks_exact(4).any(|v| v == b"avif"),
            "file is not an AVIF image"
        );
        ensure!(
            &head[8..12] != b"avis" && !brands.chunks_exact(4).any(|v| v == b"avis"),
            "AVIF sequences are unsupported"
        );
    }
    file.rewind()?;
    Ok(())
}

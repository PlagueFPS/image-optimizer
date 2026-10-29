use anyhow::{Result, ensure};
use clap::{Parser, ValueEnum};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq)]
pub enum Encoding {
    Webp,
    Preserve,
}

#[derive(Parser, Debug)]
#[command(
    version,
    about = "Convert static JPEG, PNG, AVIF, and self-contained SVG images with libvips"
)]
pub struct Args {
    /// Source file or directory. Symlinks are not followed.
    pub input: PathBuf,
    #[arg(long, conflicts_with = "output", required_unless_present = "output")]
    /// Destination tree. Original filenames and relative directories are retained.
    pub out_dir: Option<PathBuf>,
    #[arg(short = 'o', long, conflicts_with = "out_dir")]
    /// Exact destination for one source and one variant. Format is selected by --format.
    pub output: Option<PathBuf>,
    #[arg(long)]
    /// Include subdirectories, excluding the destination tree.
    pub recursive: bool,
    #[arg(long, conflicts_with = "widths", value_parser = clap::value_parser!(u32).range(1..=32768))]
    /// Fit within this width without cropping.
    pub width: Option<u32>,
    #[arg(long, value_delimiter = ',', num_args = 1, value_parser = clap::value_parser!(u32).range(1..=32768))]
    /// Comma-separated srcset widths, at most 32 unique values.
    pub widths: Vec<u32>,
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=32768))]
    /// Fit within this height, optionally combined with width.
    pub height: Option<u32>,
    #[arg(long, value_enum, default_value = "webp")]
    /// Output encoding. Preserve reencodes rasters or resizes the SVG viewport.
    pub format: Encoding,
    #[arg(long, default_value_t = 80, value_parser = clap::value_parser!(u8).range(1..=100))]
    /// Lossy JPEG, AVIF, or WebP quality. PNG remains lossless.
    pub quality: u8,
    #[arg(long, default_value_t = 6, value_parser = clap::value_parser!(u8).range(0..=6))]
    /// WebP/AVIF encoder effort or PNG compression, from 0 to 6.
    pub effort: u8,
    #[arg(long, default_value_t = 1, value_parser = clap::value_parser!(u16).range(1..=1024))]
    /// Libvips worker threads, not a hard process CPU cap.
    pub cpu: u16,
    #[arg(long)]
    /// Allow enlarging small inputs to the requested bounds.
    pub upscale: bool,
    #[arg(long)]
    /// Atomically replace existing regular outputs. Never replace input files.
    pub overwrite: bool,
    #[arg(long)]
    /// Plan outputs and inspect headers without writing or fully decoding pixels.
    pub dry_run: bool,
    #[arg(long)]
    /// Print one schema-versioned JSON report to stdout.
    pub json: bool,
    /// Reject source or output images above this pixel count. Not a hard memory limit.
    #[arg(long, default_value_t = 100_000_000)]
    pub max_pixels: u64,
}

#[derive(Clone, Copy, Debug)]
pub enum Transform {
    Original,
    Fit {
        width: Option<u32>,
        height: Option<u32>,
        upscale: bool,
    },
}

#[derive(Debug)]
pub struct Request {
    pub args: Args,
    pub transforms: Vec<Transform>,
}

impl Request {
    pub fn new(args: Args) -> Result<Self> {
        for path in std::iter::once(&args.input)
            .chain(args.out_dir.iter())
            .chain(args.output.iter())
        {
            ensure!(
                path.to_str().is_some(),
                "CLI paths must be UTF-8; reported path may be lossy"
            );
        }
        ensure!(args.max_pixels > 0, "--max-pixels must be positive");
        ensure!(args.widths.len() <= 32, "at most 32 widths are allowed");
        let mut widths = args.widths.clone();
        widths.sort_unstable();
        widths.dedup();
        ensure!(
            widths.len() == args.widths.len(),
            "duplicate widths are not allowed"
        );
        ensure!(
            args.output.is_none() || widths.len() <= 1,
            "-o requires one variant"
        );
        let transforms = if !widths.is_empty() {
            widths
                .into_iter()
                .map(|w| Transform::Fit {
                    width: Some(w),
                    height: args.height,
                    upscale: args.upscale,
                })
                .collect()
        } else if args.width.is_some() || args.height.is_some() {
            vec![Transform::Fit {
                width: args.width,
                height: args.height,
                upscale: args.upscale,
            }]
        } else {
            vec![Transform::Original]
        };
        Ok(Self { args, transforms })
    }
}

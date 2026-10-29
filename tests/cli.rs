use image::{GenericImageView, ImageBuffer, Rgba};
use serde_json::Value;
use std::{
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::TempDir;

fn invoke(input: &Path, destination: &Path, flags: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
        .arg(input)
        .arg("--out-dir")
        .arg(destination)
        .arg("--json")
        .args(flags)
        .output()
        .unwrap()
}
fn report(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)))
}
fn png(path: &Path) {
    ImageBuffer::from_fn(80, 40, |x, _| {
        Rgba([240u8, 30, 10, if x < 40 { 0 } else { 255 }])
    })
    .save(path)
    .unwrap();
}
fn assert_image(
    path: &Path,
    dimensions: (u32, u32),
    format: image::ImageFormat,
) -> image::DynamicImage {
    let reader = image::ImageReader::open(path)
        .unwrap()
        .with_guessed_format()
        .unwrap();
    assert_eq!(reader.format(), Some(format));
    let image = reader.decode().unwrap();
    assert_eq!(image.dimensions(), dimensions);
    image
}

#[test]
fn srcset_geometry_alpha_and_names() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("photo[Q=1].png");
    png(&input);
    let dest = temp.path().join("out[Q=0]");
    let result = invoke(&input, &dest, &["--widths", "20,40", "--cpu", "2"]);
    assert!(result.status.success(), "{result:?}");
    let r = report(&result);
    assert_eq!(r["schema_version"], 1);
    for (index, width) in [20, 40].into_iter().enumerate() {
        let path = dest.join(format!("photo[Q=1].png.{width}w.webp"));
        let img = assert_image(&path, (width, width / 2), image::ImageFormat::WebP).to_rgba8();
        assert_eq!(img.get_pixel(0, 0).0[3], 0);
        assert_eq!(img.get_pixel(width - 1, 0).0[3], 255);
        assert_eq!(
            r["outputs"][index]["bytes"],
            fs::metadata(path).unwrap().len()
        );
        assert_eq!(r["outputs"][index]["width"], width);
    }
}
#[test]
fn recursive_structure_collisions_overlap_and_corruption() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("in");
    fs::create_dir_all(source.join("nested")).unwrap();
    png(&source.join("photo.png"));
    image::RgbImage::new(80, 40)
        .save(source.join("photo.jpg"))
        .unwrap();
    png(&source.join("nested/photo.png"));
    fs::write(source.join("bad.jpg"), "broken").unwrap();
    fs::write(source.join("ignored.txt"), "irrelevant").unwrap();
    let dest = source.join("output");
    fs::create_dir_all(&dest).unwrap();
    png(&dest.join("do-not-process.png"));
    let result = invoke(&source, &dest, &["--recursive"]);
    assert!(!result.status.success());
    let r = report(&result);
    assert_eq!(r["outputs"].as_array().unwrap().len(), 3);
    assert_eq!(r["errors"].as_array().unwrap().len(), 1);
    for name in ["photo.png.webp", "photo.jpg.webp", "nested/photo.png.webp"] {
        assert!(dest.join(name).is_file());
    }
    assert!(!dest.join("do-not-process.png.webp").exists());
    assert!(!dest.join("bad.jpg.webp").exists());
    assert!(fs::read_dir(&dest).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".image-optimizer-")
    }));
}
#[test]
fn preserve_resize_bounds_upscale_and_dry_run() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let dest = temp.path().join("out");
    let result = invoke(
        &input,
        &dest,
        &["--format", "preserve", "--width", "40", "--height", "10"],
    );
    assert!(result.status.success(), "{result:?}");
    assert_image(
        &dest.join("x.png.40w.10h.png"),
        (20, 10),
        image::ImageFormat::Png,
    );
    let result = invoke(&input, &dest, &["--width", "160"]);
    assert!(result.status.success());
    assert_image(
        &dest.join("x.png.160w.webp"),
        (80, 40),
        image::ImageFormat::WebP,
    );
    let result = invoke(
        &input,
        &dest,
        &["--width", "160", "--upscale", "--overwrite"],
    );
    assert!(result.status.success());
    assert_image(
        &dest.join("x.png.160w.webp"),
        (160, 80),
        image::ImageFormat::WebP,
    );
    let absent = temp.path().join("absent");
    let result = invoke(&input, &absent, &["--dry-run", "--height", "10"]);
    assert!(result.status.success());
    assert!(!absent.exists());
    assert_eq!(report(&result)["outputs"][0]["bytes"], Value::Null);
    assert_eq!(report(&result)["outputs"][0]["width"], 20);
}
#[test]
fn no_clobber_and_input_identity() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let dest = temp.path().join("out");
    assert!(invoke(&input, &dest, &[]).status.success());
    let path = dest.join("x.png.webp");
    let before = fs::read(&path).unwrap();
    assert!(!invoke(&input, &dest, &[]).status.success());
    assert_eq!(fs::read(&path).unwrap(), before);
    let result = Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
        .arg(&input)
        .arg("-o")
        .arg(&input)
        .arg("--overwrite")
        .output()
        .unwrap();
    assert!(!result.status.success());
    let alias = temp.path().join("alias.png");
    fs::hard_link(&input, &alias).unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
        .arg(&input)
        .arg("-o")
        .arg(alias)
        .arg("--overwrite")
        .output()
        .unwrap();
    assert!(!result.status.success());
}
#[test]
fn jpeg_preserve_single_output_and_orientation() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("oriented.jpg");
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut bytes)
        .encode_image(&image::DynamicImage::new_rgb8(80, 40))
        .unwrap();
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend_from_slice(exif);
    oriented.extend_from_slice(&bytes[2..]);
    fs::write(&input, oriented).unwrap();
    let output = temp.path().join("result.jpg");
    let result = Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
        .arg(&input)
        .arg("-o")
        .arg(&output)
        .args(["--format", "preserve", "--width", "20"])
        .output()
        .unwrap();
    assert!(result.status.success(), "{result:?}");
    assert_image(&output, (20, 40), image::ImageFormat::Jpeg);
    assert!(
        !fs::read(output)
            .unwrap()
            .windows(6)
            .any(|v| v == b"Exif\0\0")
    );
}
#[test]
fn svg_static_and_restrictions() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.svg");
    fs::write(&input, r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="40" height="40" fill="#ff0000"/></svg>"##).unwrap();
    let dest = temp.path().join("out");
    let result = invoke(&input, &dest, &["--width", "40"]);
    assert!(result.status.success(), "{result:?}");
    let img = assert_image(
        &dest.join("x.svg.40w.webp"),
        (40, 20),
        image::ImageFormat::WebP,
    )
    .to_rgba8();
    assert_eq!(img.get_pixel(39, 0).0[3], 0);
    let preserved = invoke(&input, &dest, &["--format", "preserve", "--width", "20"]);
    assert!(preserved.status.success(), "{preserved:?}");
    let vector = fs::read_to_string(dest.join("x.svg.20w.svg")).unwrap();
    let document = roxmltree::Document::parse(&vector).unwrap();
    assert_eq!(document.root_element().attribute("width"), Some("20"));
    assert_eq!(document.root_element().attribute("height"), Some("10"));
    assert_eq!(
        document.root_element().attribute("viewBox"),
        Some("0 0 80 40")
    );
    let rerendered = invoke(
        &dest.join("x.svg.20w.svg"),
        &temp.path().join("rerendered"),
        &[],
    );
    assert!(rerendered.status.success(), "{rerendered:?}");
    assert_image(
        &temp.path().join("rerendered/x.svg.20w.svg.webp"),
        (20, 10),
        image::ImageFormat::WebP,
    );
    for content in [
        r#"<image href="file:///etc/passwd"/>"#,
        r#"<animate attributeName="x"/>"#,
        r#"<style>@import 'https://example.com/x';</style>"#,
        r#"<rect fill="URL(file:///tmp/external.svg)"/>"#,
        r#"<rect fill="u\72l(file:///tmp/external.svg)"/>"#,
    ] {
        fs::write(
            &input,
            format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">{content}</svg>"#
            ),
        )
        .unwrap();
        assert!(!invoke(&input, &dest, &["--overwrite"]).status.success());
    }
}
#[test]
fn avif_real_decode_and_preserve() {
    use libvips::{VipsApp, VipsImage, ops};
    let app = VipsApp::new("integration-avif", false).unwrap();
    app.concurrency_set(1);
    app.cache_set_max(0);
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let vips = VipsImage::new_from_file(input.to_str().unwrap()).unwrap();
    let avif = temp.path().join("x.avif");
    ops::heifsave_with_opts(
        &vips,
        avif.to_str().unwrap(),
        &ops::HeifsaveOptions {
            compression: ops::ForeignHeifCompression::Av1,
            effort: 0,
            bitdepth: 8,
            profile: None,
            ..Default::default()
        },
    )
    .unwrap();
    let dest = temp.path().join("out");
    let result = invoke(&avif, &dest, &["--width", "40"]);
    assert!(result.status.success(), "{result:?}");
    assert_image(
        &dest.join("x.avif.40w.webp"),
        (40, 20),
        image::ImageFormat::WebP,
    );
    let result = invoke(
        &avif,
        &dest,
        &["--format", "preserve", "--width", "20", "--effort", "0"],
    );
    assert!(result.status.success(), "{result:?}");
    let decoded = VipsImage::new_from_file(dest.join("x.avif.20w.avif").to_str().unwrap()).unwrap();
    assert_eq!((decoded.get_width(), decoded.get_height()), (20, 10));
    assert!(decoded.image_hasalpha());
    let pixels = ops::avg(&ops::extract_band(&decoded, 3).unwrap()).unwrap();
    assert!(pixels > 50. && pixels < 200.);
}
#[test]
fn flags_limits_and_partial_failure() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let dest = temp.path().join("out");
    for flags in [
        vec!["--width", "0"],
        vec!["--widths", "20,20"],
        vec!["--cpu", "0"],
        vec!["--effort", "7"],
        vec!["--quality", "101"],
        vec!["--max-pixels", "100"],
    ] {
        assert!(!invoke(&input, &dest, &flags).status.success(), "{flags:?}");
    }
    assert!(!dest.exists());
    for flag in ["--help", "--version"] {
        assert!(
            Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
                .arg(flag)
                .status()
                .unwrap()
                .success()
        );
    }
    let widths = (1..=33)
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join(",");
    assert!(
        !invoke(&input, &dest, &["--widths", &widths])
            .status
            .success()
    );
}
#[cfg(unix)]
#[test]
fn symlinks_excluded_and_rejected() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let link = temp.path().join("link.png");
    symlink(&input, &link).unwrap();
    let dest = temp.path().join("out");
    assert!(!invoke(&link, &dest, &[]).status.success());
    let result = invoke(temp.path(), &dest, &["--recursive"]);
    assert!(result.status.success());
    assert_eq!(report(&result)["outputs"].as_array().unwrap().len(), 1);
    fs::remove_file(dest.join("x.png.webp")).unwrap();
    symlink(&input, dest.join("x.png.webp")).unwrap();
    assert!(!invoke(&input, &dest, &["--overwrite"]).status.success());
}
#[test]
fn apng_and_truncated_files_rejected() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("x.png");
    png(&input);
    let original = fs::read(&input).unwrap();
    let mut animated = original[..33].to_vec();
    animated.extend_from_slice(&[0, 0, 0, 8]);
    animated.extend_from_slice(b"acTL");
    animated.extend_from_slice(&[0; 12]);
    animated.extend_from_slice(&original[33..]);
    fs::write(&input, animated).unwrap();
    let dest = temp.path().join("out");
    assert!(!invoke(&input, &dest, &[]).status.success());
    fs::write(&input, &original[..original.len() / 2]).unwrap();
    assert!(!invoke(&input, &dest, &[]).status.success());
    assert!(!dest.exists());
    let jpeg = temp.path().join("x.jpg");
    image::RgbImage::new(80, 40).save(&jpeg).unwrap();
    let bytes = fs::read(&jpeg).unwrap();
    fs::write(&jpeg, &bytes[..bytes.len() - 50]).unwrap();
    assert!(!invoke(&jpeg, &dest, &[]).status.success());
}

#[test]
fn quality_setting_changes_encoded_output() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("noise.png");
    ImageBuffer::from_fn(80, 40, |x, y| {
        Rgba([
            ((x * 13 + y * 7) % 256) as u8,
            ((x * 23 + y * 19) % 256) as u8,
            ((x * 31 + y * 29) % 256) as u8,
            255u8,
        ])
    })
    .save(&input)
    .unwrap();
    let low = temp.path().join("low");
    let high = temp.path().join("high");
    assert!(
        invoke(&input, &low, &["--quality", "1", "--effort", "0"])
            .status
            .success()
    );
    assert!(
        invoke(&input, &high, &["--quality", "100", "--effort", "6"])
            .status
            .success()
    );
    assert!(
        fs::metadata(low.join("noise.png.webp")).unwrap().len()
            < fs::metadata(high.join("noise.png.webp")).unwrap().len()
    );
}

#[test]
fn nonrecursive_and_empty_directories() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("in");
    fs::create_dir_all(input.join("nested")).unwrap();
    png(&input.join("nested/x.png"));
    let dest = temp.path().join("out");
    let result = invoke(&input, &dest, &[]);
    assert!(result.status.success());
    assert!(report(&result)["outputs"].as_array().unwrap().is_empty());
    assert!(!dest.exists());
}

#[test]
fn mislabeled_input_and_zero_pixel_limit() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("x.png");
    png(&source);
    let fake = temp.path().join("x.jpg");
    fs::copy(source, &fake).unwrap();
    let dest = temp.path().join("out");
    assert!(!invoke(&fake, &dest, &[]).status.success());
    assert!(
        !invoke(&fake, &dest, &["--max-pixels", "0"])
            .status
            .success()
    );
    assert!(!dest.exists());
}

#[test]
fn destination_ancestor_does_not_exclude_sources() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("in");
    fs::create_dir(&source).unwrap();
    png(&source.join("x.png"));
    let result = invoke(&source, temp.path(), &["--recursive"]);
    assert!(result.status.success());
    assert_eq!(report(&result)["outputs"].as_array().unwrap().len(), 1);
    assert_image(
        &temp.path().join("x.png.webp"),
        (80, 40),
        image::ImageFormat::WebP,
    );
}

#[test]
fn non_utf8_names_fail_explicitly_without_stopping_other_inputs() {
    use std::os::unix::ffi::OsStringExt;
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("in");
    fs::create_dir(&source).unwrap();
    png(&source.join("good.png"));
    png(&source.join(std::ffi::OsString::from_vec(b"bad\xff.png".to_vec())));
    let result = invoke(&source, &temp.path().join("out"), &[]);
    assert!(!result.status.success());
    assert_eq!(report(&result)["outputs"].as_array().unwrap().len(), 1);
    assert_eq!(report(&result)["errors"].as_array().unwrap().len(), 1);
}

#[test]
fn reviewed_metadata_svg_and_independent_failure_contracts() {
    let temp = TempDir::new().unwrap();
    let input = temp.path().join("input");
    fs::create_dir(&input).unwrap();
    png(&input.join("a.png"));
    png(&input.join("b.png"));
    let dest = temp.path().join("out");
    fs::create_dir_all(dest.join("a.png.webp")).unwrap();
    let result = invoke(&input, &dest, &[]);
    assert!(!result.status.success());
    assert_eq!(report(&result)["outputs"].as_array().unwrap().len(), 1);
    let bytes = fs::read(dest.join("b.png.webp")).unwrap();
    assert!(!bytes.windows(4).any(|w| w == b"ICCP"));
    let svg = temp.path().join("gradient.svg");
    fs::write(&svg, r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><defs><linearGradient id="urlGradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="80" height="40" fill="url(#urlGradient)"/></svg>"##).unwrap();
    let result = invoke(&svg, &dest, &[]);
    assert!(result.status.success(), "{result:?}");
    assert_image(
        &dest.join("gradient.svg.webp"),
        (80, 40),
        image::ImageFormat::WebP,
    );
    let result = Command::new(env!("CARGO_BIN_EXE_image-optimizer"))
        .current_dir(temp.path())
        .args(["missing.png", "--out-dir", "out", "--json"])
        .output()
        .unwrap();
    assert!(Path::new(report(&result)["errors"][0]["input"].as_str().unwrap()).is_absolute());
}

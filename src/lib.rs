use std::{error::Error, fs, path::{Path, PathBuf}};
use image::{GenericImageView, ImageReader};
use webpx::{EncoderConfig, Unstoppable};
use rayon::prelude::*;

pub fn run(source_dir: &Path, target_dir: &Path) -> Result<(), Box<dyn Error>> {
	if !target_dir.exists() {
		fs::create_dir_all(target_dir)?;
	}

	if !source_dir.exists() || !source_dir.is_dir() {
		eprintln!("Provided source directory either does not exist or is not a directory");
		return Ok(());
	}

	get_image_files(source_dir)?.into_par_iter().for_each(|image_path| {
		let Some(file_name) = image_path.file_name().and_then(|n| n.to_str()) else {
			return;
		};

		let output_path = target_dir.join(format!("{file_name}_optimized")).with_extension("webp");
		optimize_image(&image_path, &output_path).ok();
	});

	Ok(())
}

fn is_supported_format(image_path: &Path) -> bool {
	let supported_formats = ["jpg", "jpeg", "png"];

	image_path
		.extension()
		.and_then(|s| s.to_str())
		.map(|ext| supported_formats.iter().any(|f| ext.eq_ignore_ascii_case(f)))
		.unwrap_or(false)
}

fn get_image_files(dir_path: &Path) -> Result<Vec<PathBuf>, Box<dyn Error>> {
	let mut image_files = Vec::new();
	for entry in fs::read_dir(dir_path)? {
		let path = entry?.path();
		if path.is_file() && is_supported_format(&path) {
			image_files.push(path);
		}
	}

	Ok(image_files)
}

fn optimize_image(image_path: &Path, output_path: &Path) -> Result<(), Box<dyn Error>> {
	let img = ImageReader::open(image_path)?.decode()?;
	let (width, height) = img.dimensions();
	let (rgb, has_alpha) = if img.color().has_alpha() {
		(img.to_rgb8().into_raw(), true)
	} else {
		(img.to_rgb8().into_raw(), false)
	};

	let output_data = if has_alpha {
		EncoderConfig::max_compression()
			.encode_rgba(&rgb, width, height, Unstoppable)?
	} else {
		EncoderConfig::max_compression()
			.encode_rgb(&rgb, width, height, Unstoppable)?
	};

	fs::write(output_path, output_data)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::Path;
	use tempfile::TempDir;

	/// Validates that a file is valid WebP by checking the RIFF/WEBP header.
	fn is_valid_webp(path: &Path) -> bool {
		let Ok(data) = fs::read(path) else {
			return false;
		};
		data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP"
	}

	#[test]
	fn test_is_supported_format() {
		let jpg_path = Path::new("tests/fixtures/test.jpg");
		let jpeg_path = Path::new("tests/fixtures/test.jpeg");
		let png_path = Path::new("tests/fixtures/test.png");
		let unsupported_path = Path::new("tests/fixtures/test.txt");
		assert!(is_supported_format(jpg_path));
		assert!(is_supported_format(jpeg_path));
		assert!(is_supported_format(png_path));
		assert!(!is_supported_format(unsupported_path));
	}

	#[test]
	fn test_get_image_files() {
		let dir_path = Path::new("tests/fixtures");
		let image_files = get_image_files(dir_path).unwrap();
		let test_file = Path::new("tests/fixtures/test.jpg");
		assert!(image_files.contains(&test_file.to_path_buf()));
	}

	#[test]
	fn test_optimize_image() {
		let source_path = Path::new("tests/fixtures/test.jpg");
		let temp_dir = TempDir::new().unwrap();
		let output_path = temp_dir.path().join("test_optimized.webp");

		optimize_image(source_path, &output_path).unwrap();

		// Validate: file exists, is non-empty, and is valid WebP
		assert!(output_path.exists(), "Output file should exist");
		assert!(
			output_path.metadata().unwrap().len() > 0,
			"Output file should not be empty"
		);
		assert!(is_valid_webp(&output_path), "Output should be valid WebP format");
	}

	#[test]
	fn test_run() {
		let source_dir = Path::new("tests/fixtures");
		let temp_dir = TempDir::new().unwrap();
		let target_dir = temp_dir.path();

		run(source_dir, target_dir).unwrap();

		// Validate: output files were created and are valid WebP
		let entries: Vec<_> = fs::read_dir(target_dir).unwrap().collect();
		assert!(!entries.is_empty(), "Expected at least one output file");

		for entry in entries {
			let path = entry.unwrap().path();
			assert!(
				path.extension().map_or(false, |e| e == "webp"),
				"Output should have .webp extension"
			);
			assert!(is_valid_webp(&path), "Output should be valid WebP format");
		}
	}
}

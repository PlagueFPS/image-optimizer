use std::{error::Error, fs, path::{Path, PathBuf}};
use image::{GenericImageView, ImageReader};
use webpx::{EncoderConfig, Unstoppable};

pub fn run(source_dir: &Path, target_dir: &Path) -> Result<(), Box<dyn Error>> {
	for image_path in get_image_files(source_dir)? {
		if !is_supported_format(&image_path) {
			continue;
		}

		let Some(file_name) = image_path.file_name().and_then(|n| n.to_str()) else {
			continue;
		};

		if !target_dir.exists() {
			fs::create_dir(target_dir)?;
		}

		let output_path = target_dir.join(format!("{file_name}_optimized")).with_extension("webp");
		optimize_image(&image_path, &output_path)?;
	}

	Ok(())
}

fn is_supported_format(image_path: &PathBuf) -> bool {
	let supported_formats = ["jpg", "jpeg", "png"];

	image_path
		.extension()
		.and_then(|s| s.to_str())
		.map(|ext| supported_formats.contains(&ext))
		.unwrap_or(false)
}

fn get_image_files(dir_path: &Path) -> Result<Vec<PathBuf>, Box<dyn Error>> {
	let mut image_files = Vec::new();
	for entry in fs::read_dir(&dir_path)? {
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
	let rgb = img.to_rgb8().into_raw();

	let output_data = EncoderConfig::max_compression()
		.thread_level(1)
		.encode_rgb(&rgb, width, height, Unstoppable)?;
	fs::write(output_path, output_data)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::Path;

	#[test]
	fn test_is_supported_format() {
		let jpg_path = Path::new("tests/fixtures/test.jpg");
		let jpeg_path = Path::new("tests/fixtures/test.jpeg");
		let png_path = Path::new("tests/fixtures/test.png");
		let unsupported_path = Path::new("tests/fixtures/test.txt");
		assert!(is_supported_format(&jpg_path.to_path_buf()));
		assert!(is_supported_format(&jpeg_path.to_path_buf()));
		assert!(is_supported_format(&png_path.to_path_buf()));
		assert!(!is_supported_format(&unsupported_path.to_path_buf()));
	}

	#[test]
	fn test_get_image_files() {
		let dir_path = Path::new("tests/fixtures");
		let image_files = get_image_files(&dir_path).unwrap();
		let test_file = Path::new("tests/fixtures/test.jpg");
		assert!(image_files.contains(&test_file.to_path_buf()));
	}

	#[test]
	fn test_optimize_image() {
		let source_path = Path::new("tests/fixtures/test.jpg");
		let output_path = Path::new("tests/fixtures/test_optimized.webp");

		optimize_image(&source_path, &output_path).unwrap();
	}

	#[test]
	fn test_run() {
		let source_dir = Path::new("tests/fixtures");
		let target_dir = Path::new("tests/output");
		run(&source_dir, &target_dir).unwrap();
		let output_path = target_dir.join("test.webp");
		assert!(output_path.exists());
	}
}

use std::path::Path;
use clap::Parser;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
	/// Target directory to store optimized images
	#[arg(long, required = true)]
	target_dir: String,

	/// Source directory for images to optimize
	#[arg(short, long, default_value = "./newassets")]
	source_dir: String,
}

fn main() {
	let args = Args::parse();
	let source_dir = Path::new(&args.source_dir);
	let target_dir = Path::new(&args.target_dir);
	if let Err(e) = image_optimizer::run(source_dir, target_dir) {
		eprintln!("Application error: {e}");
	}
}

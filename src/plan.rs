use crate::request::{Encoding, Request, Transform};
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Jpeg,
    Png,
    Avif,
    Svg,
    Webp,
}
impl Format {
    pub fn of(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            "avif" => Some(Self::Avif),
            "svg" => Some(Self::Svg),
            _ => None,
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Avif => "avif",
            Self::Svg => "svg",
            Self::Webp => "webp",
        }
    }
}
#[derive(Debug)]
pub struct PlannedOutput {
    pub input: PathBuf,
    pub output: PathBuf,
    pub source_format: Format,
    pub format: Format,
    pub transform: Transform,
}
#[derive(Debug, Serialize)]
pub struct Failure {
    pub input: PathBuf,
    pub output: Option<PathBuf>,
    pub error: String,
}
#[derive(Default)]
pub struct Plan {
    pub outputs: Vec<PlannedOutput>,
    pub errors: Vec<Failure>,
}

pub fn absolute(path: &Path) -> Result<PathBuf> {
    let full = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut clean = PathBuf::new();
    for part in full.components() {
        match part {
            Component::ParentDir => {
                clean.pop();
            }
            Component::CurDir => {}
            c => clean.push(c),
        }
    }
    let mut ancestor = clean.as_path();
    let mut missing = Vec::new();
    while !ancestor.try_exists()? {
        missing.push(
            ancestor
                .file_name()
                .context("invalid destination")?
                .to_owned(),
        );
        ancestor = ancestor.parent().context("invalid destination")?;
    }
    let mut resolved = ancestor.canonicalize()?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved)
}

pub fn reject_symlinks(path: &Path) -> Result<()> {
    let mut prefix = PathBuf::new();
    let full = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()?.join(path)
    };
    for part in full.components() {
        prefix.push(part);
        match fs::symlink_metadata(&prefix) {
            Ok(m) => ensure!(
                !m.file_type().is_symlink(),
                "symlink paths are not allowed: {}",
                prefix.display()
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

pub fn build(request: &Request) -> Result<Plan> {
    let args = &request.args;
    reject_symlinks(&args.input)?;
    let input = args.input.canonicalize().context("cannot open input")?;
    let is_dir = input.is_dir();
    ensure!(
        !is_dir || args.output.is_none(),
        "-o requires a single source file"
    );
    let destination = args.out_dir.as_ref().or(args.output.as_ref()).unwrap();
    reject_symlinks(destination)?;
    let destination = absolute(destination)?;
    ensure!(
        !is_dir || destination != input,
        "output directory must differ from input directory"
    );
    let mut plan = Plan::default();
    let mut sources = Vec::new();
    if is_dir {
        for entry in WalkDir::new(&input)
            .follow_links(false)
            .max_depth(if args.recursive { usize::MAX } else { 1 })
            .into_iter()
            .filter_entry(|e| {
                !destination.starts_with(&input)
                    || e.path() == input
                    || !e.path().starts_with(&destination)
            })
        {
            match entry {
                Ok(e) if e.file_type().is_file() && Format::of(e.path()).is_some() => {
                    sources.push(e.into_path())
                }
                Ok(_) => {}
                Err(e) => plan.errors.push(Failure {
                    input: PathBuf::from(e.path().unwrap_or(&input).to_string_lossy().as_ref()),
                    output: None,
                    error: e.to_string(),
                }),
            }
        }
    } else {
        ensure!(input.is_file(), "input must be a regular file");
        sources.push(input.clone());
    }
    sources.sort();
    let source_set: HashSet<_> = sources.iter().cloned().collect();
    use std::os::unix::fs::MetadataExt;
    let mut input_identities = HashSet::new();
    for source in &source_set {
        let metadata = fs::metadata(source)?;
        input_identities.insert((metadata.dev(), metadata.ino()));
    }
    let mut producers = HashSet::new();
    for source in sources {
        if source.to_str().is_none() {
            plan.errors.push(Failure {
                input: PathBuf::from(source.to_string_lossy().as_ref()),
                output: None,
                error: "input path must be UTF-8; reported path is lossy".into(),
            });
            continue;
        }
        let Some(source_format) = Format::of(&source) else {
            bail!("unsupported input extension: {}", source.display());
        };
        let format = if args.format == Encoding::Preserve {
            source_format
        } else {
            Format::Webp
        };
        for transform in &request.transforms {
            let output = if args.output.is_some() {
                destination.clone()
            } else {
                let relative = if is_dir {
                    source.strip_prefix(&input)?
                } else {
                    Path::new(source.file_name().unwrap())
                };
                let name = relative
                    .file_name()
                    .unwrap()
                    .to_str()
                    .context("input filenames must be UTF-8")?;
                let suffix = match transform {
                    Transform::Original => String::new(),
                    Transform::Fit {
                        width: Some(w),
                        height: Some(h),
                        ..
                    } => format!(".{w}w.{h}h"),
                    Transform::Fit { width: Some(w), .. } => format!(".{w}w"),
                    Transform::Fit {
                        height: Some(h), ..
                    } => format!(".{h}h"),
                    _ => unreachable!(),
                };
                destination
                    .join(relative.parent().unwrap())
                    .join(format!("{name}{suffix}.{}", format.extension()))
            };
            ensure!(
                !source_set.contains(&output),
                "output is also an input: {}",
                output.display()
            );
            ensure!(
                producers.insert(output.clone()),
                "duplicate output: {}",
                output.display()
            );
            reject_symlinks(&output)?;
            if output.exists() {
                ensure!(
                    output.is_file(),
                    "output is not a regular file: {}",
                    output.display()
                );
                let metadata = fs::metadata(&output)?;
                ensure!(
                    !input_identities.contains(&(metadata.dev(), metadata.ino())),
                    "output aliases an input: {}",
                    output.display()
                );
                if !args.overwrite {
                    plan.errors.push(Failure {
                        input: source.clone(),
                        output: Some(output),
                        error: "output exists (use --overwrite)".into(),
                    });
                    continue;
                }
            }
            plan.outputs.push(PlannedOutput {
                input: source.clone(),
                output,
                source_format,
                format,
                transform: *transform,
            });
        }
    }
    Ok(plan)
}

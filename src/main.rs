use clap::Parser;
use image_optimizer::{
    backend::{Backend, Output},
    plan::{self, Failure},
    request::{Args, Request},
};
use serde::Serialize;

#[derive(Serialize)]
struct Report {
    schema_version: u32,
    dry_run: bool,
    outputs: Vec<Output>,
    errors: Vec<Failure>,
}
fn main() {
    let args = Args::parse();
    let json = args.json;
    let dry_run = args.dry_run;
    let input = std::path::PathBuf::from(args.input.to_string_lossy().as_ref());
    let result = (|| -> anyhow::Result<Report> {
        let request = Request::new(args)?;
        let plan = plan::build(&request)?;
        let backend = Backend::new(request.args.cpu)?;
        let mut report = Report {
            schema_version: 1,
            dry_run,
            outputs: Vec::new(),
            errors: plan.errors,
        };
        for job in plan.outputs {
            match backend.process(&job, &request.args) {
                Ok(output) => report.outputs.push(output),
                Err(e) => report.errors.push(Failure {
                    input: job.input,
                    output: Some(job.output),
                    error: format!("{e:#}"),
                }),
            }
        }
        Ok(report)
    })();
    let report = result.unwrap_or_else(|e| Report {
        schema_version: 1,
        dry_run,
        outputs: vec![],
        errors: vec![Failure {
            input,
            output: None,
            error: format!("{e:#}"),
        }],
    });
    if json {
        println!(
            "{}",
            serde_json::to_string(&report).expect("report serialization")
        );
    } else {
        for output in &report.outputs {
            println!(
                "{} -> {} ({}x{}, {} bytes)",
                output.input.display(),
                output.output.display(),
                output.width,
                output.height,
                output
                    .bytes
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "planned".into())
            );
        }
        for error in &report.errors {
            eprintln!("{}: {}", error.input.display(), error.error);
        }
        eprintln!(
            "{} output(s), {} error(s){}",
            report.outputs.len(),
            report.errors.len(),
            if dry_run { " (dry run)" } else { "" }
        );
    }
    if !report.errors.is_empty() {
        std::process::exit(1);
    }
}

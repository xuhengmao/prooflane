use std::ffi::OsStr;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

fn usage(program: &OsStr) {
    eprintln!(
        "Usage: {} <release-asset> <signature-file>",
        Path::new(program).display()
    );
}

fn main() -> ExitCode {
    let mut args = std::env::args_os();
    let program = args
        .next()
        .unwrap_or_else(|| "prooflane-verify-release".into());
    let Some(asset_path) = args.next() else {
        usage(&program);
        return ExitCode::FAILURE;
    };
    let Some(signature_path) = args.next() else {
        usage(&program);
        return ExitCode::FAILURE;
    };
    if args.next().is_some() {
        usage(&program);
        return ExitCode::FAILURE;
    }

    let asset = match fs::read(&asset_path) {
        Ok(asset) => asset,
        Err(error) => {
            eprintln!(
                "failed to read release asset {}: {error}",
                Path::new(&asset_path).display()
            );
            return ExitCode::FAILURE;
        }
    };
    let signature = match fs::read_to_string(&signature_path) {
        Ok(signature) => signature,
        Err(error) => {
            eprintln!(
                "failed to read release signature {}: {error}",
                Path::new(&signature_path).display()
            );
            return ExitCode::FAILURE;
        }
    };

    match codeg_lib::update::verify::verify_release_signature(&asset, &signature) {
        Ok(()) => {
            println!(
                "Release signature verified: {}",
                Path::new(&asset_path).display()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("release signature verification failed: {error}");
            ExitCode::FAILURE
        }
    }
}

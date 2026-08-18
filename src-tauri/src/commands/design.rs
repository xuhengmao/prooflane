#[cfg(debug_assertions)]
use std::path::Path;

#[cfg(debug_assertions)]
use crate::design::package::{
    load_package, save_package, LoadedDesignPackage, PackageError, PackageManifest, PackageReceipt,
};

#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn save_design_package(
    path: &Path,
    manifest: &PackageManifest,
    ast: &[u8],
) -> Result<PackageReceipt, PackageError> {
    save_package(path, manifest, ast)
}

#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn load_design_package(path: &Path) -> Result<LoadedDesignPackage, PackageError> {
    load_package(path)
}

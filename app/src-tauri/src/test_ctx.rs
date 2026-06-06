#[cfg(target_os = "android")]
pub fn test_ctx() {
    let _ctx = ndk_context::android_context();
}

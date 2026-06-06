cd E:\Telegram-Drive-main\Telegram-Drive-main\app
npm run tauri build
if ($LASTEXITCODE -eq 0) {
    npm run tauri android build -- --apk true
}

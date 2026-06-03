<div align="center">
  <img src="app/src-tauri/icons/128x128@2x.png" alt="Telegram Drive Logo" width="200" />

  <br />
  <br />

  <h1 align="center">Telegram Drive</h1>
  <p align="center">
    <strong>Unlimited Storage. Reinvented.</strong>
    <br />
    The premium, open-source cloud storage platform powered by Telegram's infinite infrastructure.
  </p>

  <p align="center">
    <a href="https://github.com/nfsprogramming/Telegram-Drive/releases"><img src="https://img.shields.io/github/v/release/nfsprogramming/Telegram-Drive?style=for-the-badge&color=C62524" alt="Release" /></a>
    <a href="https://github.com/nfsprogramming/Telegram-Drive/stargazers"><img src="https://img.shields.io/github/stars/nfsprogramming/Telegram-Drive?style=for-the-badge&color=C62524" alt="Stars" /></a>
    <a href="https://github.com/nfsprogramming/Telegram-Drive/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License" /></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4caf50.svg?style=for-the-badge" alt="Platform" />
    <img src="https://img.shields.io/badge/Built_with-Rust%20%7C%20Tauri-e5732c.svg?style=for-the-badge" alt="Tech" />
  </p>

  <h3>
    <a href="#installation">📥 Download</a>
    <span> | </span>
    <a href="#features">✨ Features</a>
    <span> | </span>
    <a href="#tech-stack">🏗 Architecture</a>
  </h3>
</div>

<br />

## 🌟 What is Telegram Drive?

**Telegram Drive** is an open-source, cross-platform desktop application that leverages the Telegram API to give you an unlimited, secure cloud storage drive. It transforms your "Saved Messages" and private channels into a familiar, high-performance virtual filesystem.

Stop paying for Google Drive and Dropbox. Own your cloud.

## ✨ Features

*   **♾️ Unlimited Cloud Storage**: Utilizing Telegram's unthrottled global CDN infrastructure.
*   **🔒 Zero-Knowledge Architecture**: API keys and data stay local. No third-party servers.
*   **🎨 Premium Glassmorphism UI**: Beautiful AMOLED Neon Red theme with native OS integration.
*   **⚡ High Performance Grid**: Virtual scrolling handles folders with thousands of files instantly.
*   **🗂️ Folder Management**: Create "Folders" (private Telegram Channels) to organize content natively.
*   **▶️ Media Streaming**: Stream video and audio files directly without downloading them first.
*   **📄 PDF Viewer:** Built-in PDF support with infinite scrolling for seamless document reading.
*   **🖱️ Drag & Drop**: Intuitive drag-and-drop upload and file management.

## 🏗 Tech Stack

*   **Frontend**: React, TypeScript, TailwindCSS, Framer Motion
*   **Backend**: Rust (Tauri), Grammers (Telegram Client)
*   **Build Tool**: Vite

## 📥 Installation & Getting Started

### Prerequisites

*   **Node.js (v18+)**: [Download here](https://nodejs.org/)
*   **Rust (latest stable)**: Required to compile the Tauri backend. Install via [rustup](https://rustup.rs/):
    *   **Windows:** Download and run `rustup-init.exe` from [rustup.rs](https://rustup.rs/)
*   **OS-Specific Build Tools for Tauri**: 
    *   **Windows (CRITICAL):** You **must** install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). During installation, select the **"Desktop development with C++"** workload.
*   **Telegram API Credentials**: You need your own API ID and API Hash to communicate with Telegram's servers securely.
    1. Log into [my.telegram.org](https://my.telegram.org).
    2. Go to "API development tools" and create a new application to get your `api_id` and `api_hash`.

> [!NOTE]  
> **First-run Compile Time:** The initial build (`npm run tauri dev` or `npm run tauri build`) will download and compile over 300 Rust crates. This process can take **5 to 15 minutes** depending on your hardware. Subsequent builds will be much faster.

### Building from Source

1.  **Clone the repository**
    ```bash
    git clone https://github.com/nfsprogramming/Telegram-Drive.git
    cd Telegram-Drive
    ```

2.  **Install Dependencies**
    ```bash
    cd app
    npm install
    ```

3.  **Run in Development Mode**
    ```bash
    npm run tauri dev
    ```

4.  **Compile to .exe / .dmg**
    ```bash
    npm run tauri build
    ```

## 🤝 Open Source & License

This project is **Free and Open Source Software** proudly created and maintained by **NFS Programming**. You are free to use, modify, and distribute it.

Licensed under the **MIT License**.

---
*Disclaimer: This application is not affiliated with Telegram FZ-LLC. Use responsibly and in accordance with Telegram's Terms of Service.*

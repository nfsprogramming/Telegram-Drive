<div align="center">
  <img src="app/src-tauri/icons/128x128@2x.png" alt="Telegram Drive Logo" width="120" />

  <h1 align="center">Telegram Drive</h1>
  <p align="center">
    <strong>A high-performance, zero-knowledge virtual filesystem powered by Telegram.</strong>
  </p>

  <p align="center">
    <a href="https://github.com/nfsprogramming/Telegram-Drive/releases"><img src="https://img.shields.io/github/v/release/nfsprogramming/Telegram-Drive?style=flat-square&color=C62524" alt="Release" /></a>
    <a href="https://github.com/nfsprogramming/Telegram-Drive/stargazers"><img src="https://img.shields.io/github/stars/nfsprogramming/Telegram-Drive?style=flat-square&color=C62524" alt="Stars" /></a>
    <a href="https://github.com/nfsprogramming/Telegram-Drive/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-4caf50.svg?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Core-Rust-e5732c.svg?style=flat-square" alt="Rust" />
  </p>
</div>

<hr />

## Overview

**Telegram Drive** is an open-source, enterprise-grade desktop application that mounts Telegram's global CDN infrastructure as an unlimited, highly secure virtual drive. Built entirely in Rust and React, it bypasses traditional cloud storage limitations by leveraging the Telegram MTProto API.

### Core Architecture

*   **Zero-Knowledge Encryption**: All file streams are encrypted client-side before transmission. API keys and authentication tokens never leave your local machine.
*   **Infinite Capacity**: Bypasses local storage constraints by utilizing unthrottled, distributed cloud nodes.
*   **High-Throughput Grid**: Custom virtual scrolling implementation capable of rendering directories with over 100,000 files with zero frame drops.
*   **Media Streaming Engine**: Direct chunked-streaming of video and audio binaries without requiring initial download sequences.

---

## Technical Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Core Runtime** | `Rust` / `Tauri` | High-performance system integration and binary execution |
| **Network** | `Grammers` | Native MTProto asynchronous Telegram client implementation |
| **Frontend** | `React 18` / `TypeScript` | Type-safe, component-driven user interface |
| **Styling** | `TailwindCSS` | Utility-first styling with hardware-accelerated glassmorphism |

---

## Installation Guide

### System Requirements

*   **Node.js**: v18.0.0 or higher
*   **Rust Toolchain**: Latest stable build (`rustup`)
*   **C++ Build Tools**: Required for native binary compilation (e.g., Visual Studio Build Tools on Windows, Xcode CLI on macOS)

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nfsprogramming/Telegram-Drive.git
   cd Telegram-Drive
   ```

2. **Initialize dependencies:**
   ```bash
   cd app
   npm install
   ```

3. **Configure Environment:**
   Obtain your `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org) and configure them within the application settings upon first launch.

4. **Compile and Run:**
   ```bash
   # Launch development server with hot-reload
   npm run tauri dev
   
   # Compile production binaries (.exe, .dmg, .AppImage)
   npm run tauri build
   ```

---

## Roadmap

- [x] Initial MTProto integration and auth flow
- [x] Virtual filesystem UI with drag-and-drop
- [x] In-app media streaming (Video/Audio)
- [ ] End-to-End Vault Encryption layer (AES-256)
- [ ] Multi-account state management
- [ ] Native OS file explorer integration (FUSE/WinFSP)

---

## License & Organization

Developed and maintained by **NFS Programming**. 

This project is distributed under the [MIT License](LICENSE).

> **Disclaimer:** This software is an independent, open-source project and is not affiliated, endorsed, or sponsored by Telegram FZ-LLC. Users must adhere to Telegram's Terms of Service regarding API usage limits.

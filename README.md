<p align="center">
  <img src="AuraReader.png" alt="AuraReader Logo" width="128" height="128" style="border-radius: 28px;" />
</p>

<h1 align="center">AuraReader 📖✨</h1>

<p align="center">
  <b>A high-performance, distraction-free desktop e-book and document reader crafted for modern reading workflows.</b>
</p>

<p align="center">
  <!-- Live Total Downloads Badge from GitHub Releases -->
  <a href="https://github.com/freddy777-01/AuraReader/releases">
    <img src="https://img.shields.io/github/downloads/freddy777-01/AuraReader/total.svg?style=flat-square&logo=github&color=f59e0b&label=Total%20Downloads" alt="Total Downloads" />
  </a>

  <!-- Live Latest Release Version Badge -->
  <a href="https://github.com/freddy777-01/AuraReader/releases/latest">
    <img src="https://img.shields.io/github/v/release/freddy777-01/AuraReader?style=flat-square&color=10b981&label=Latest%20Version" alt="Latest Version" />
  </a>

  <!-- Platform Badge -->
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078d4?style=flat-square&logo=windows&logoColor=white" alt="Platform" />

  <!-- Privacy / Offline Badge -->
  <img src="https://img.shields.io/badge/Privacy-100%25%20Offline%20%26%20Local-10b981?style=flat-square" alt="Privacy" />
</p>

<p align="center">
  AuraReader gives you a premium, native desktop reading sanctuary on your Windows PC. No subscriptions, no telemetry, and 100% private.
</p>

---

## 🌟 Key Features

### 📚 Multi-Format Reading Engine
- **Universal Format Support**: Seamlessly open and read **EPUB**, **PDF**, and **MOBI / AZW** e-books and documents in one unified workspace.
- **Flexible Navigation Modes**: Switch effortlessly between **Single Page**, **Two-Page Spread**, and **Continuous Scroll** modes, with an interactive progress scrubber, visual **Pages Grid**, and hierarchical **Table of Contents**.
- **Instant Highlights & Notebook**: Highlight text in **Amber**, **Emerald**, **Sky**, or **Rose** with personal notes, bookmark exact locations, and jump back to any annotation with a single click.

### 🎨 Smart Bookshelf & Adaptive Themes
- **Rich Visual Bookshelf**: Automatically extracts cover artwork, authors, and metadata. Filter and group your library by **Favorites**, **Format**, **Author**, **Folder**, or custom **`#tags`**.
- **Eye-Comfort Reading Themes**: Thoughtfully tuned **Light**, warm **Sepia**, and softened Slate Charcoal **Night** modes—including smart dark-mode canvas inversion for PDFs.

### 🔒 100% Private, Local & Sync-Ready
- All library records, reading progress, highlights, and bookmarks are stored locally in an embedded **Rust + SQLite (WAL)** database on your computer.
- Zero analytics, zero mandatory accounts, and zero tracking—with optional local `.sqlite` snapshot backups and **Microsoft OneDrive (`AppFolder`)** cloud backup.

---

## ⌨️ Desktop Shortcuts

| Key | Action |
| :--- | :--- |
| <kbd>→</kbd> / <kbd>PageDown</kbd> | Next Page / Chapter Section |
| <kbd>←</kbd> / <kbd>PageUp</kbd> | Previous Page / Chapter Section |
| <kbd>Enter</kbd> *(in Page Box)* | Jump Directly to Page Number |
| <kbd>Enter</kbd> *(in Highlight Bar)* | Save Highlight & Note Instantly |
| <kbd>Esc</kbd> | Close Active Modal / Popover |

---

## 🚀 Installation & Running

### 📥 Download for Windows (64-bit)

<p align="left">
  <a href="https://github.com/freddy777-01/AuraReader/releases/latest">
    <img src="https://img.shields.io/badge/Download_AuraReader-Windows_Installer-f59e0b?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows" />
  </a>
</p>

1. Download **`AuraReader_0.1.0_x64-setup.exe`** (or `.msi`) from the [Latest Release](https://github.com/freddy777-01/AuraReader/releases/latest) page.
2. Run the installer and launch **AuraReader**.
3. Open a book file or scan your local book folders in **Settings** and enjoy reading!

> **Note on Tracking**: Download statistics are tracked automatically by GitHub Releases and reflected live on the **Total Downloads** badge above.

---

### 💻 Building from Source

```bash
# 1. Clone the repository
git clone https://github.com/freddy777-01/AuraReader.git
cd AuraReader

# 2. Install dependencies
npm install

# 3. Run in development mode
npm run tauri dev

# 4. Build Windows production installer
npm run tauri build
```

---

<p align="center">
  <b>Powered by FEMAG</b> • Crafted with ❤️ for book lovers and curious minds worldwide
</p>

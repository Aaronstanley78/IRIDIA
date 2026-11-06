<div align="center">

<img src="src/renderer/assets/icon.png" width="120" alt="IRIDIA logo">

# IRIDIA

### Every disc. Every format. Every channel.

**IRIDIA rips audio CDs to every audio format in FFmpeg 9.0.2, plus native DSD (DSF / DFF), in layouts from mono up to 7.1 surround.**

![Version](https://img.shields.io/badge/version-1.0.0-8b7cff?style=for-the-badge)
![Platform](https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-7cf7ff?style=for-the-badge)
![FFmpeg](https://img.shields.io/badge/FFmpeg-9.0.2-ff6bd5?style=for-the-badge)
![License](https://img.shields.io/badge/license-GPL--3.0-ffc46b?style=for-the-badge)

<img src="docs/screenshots/main.png" alt="IRIDIA main window ripping a CD to FLAC, DSF, Opus and ALAC in 7.1" width="100%">

</div>

---

## ✨ Highlights

- **142 output presets**, covering all 89 audio encoders in FFmpeg 9.0.2 (everything except the `anull` placeholder), each paired with the containers that suit it. That includes FLAC, ALAC, WavPack, TTA, MLP, TrueHD, WAV/RF64/W64, AIFF, CAF, MP3 (LAME, Shine, Media Foundation), AAC, Opus, Vorbis, AC-3, E-AC-3, DTS, MP2, WMA, LC3, aptX/aptX HD, SBC, AMR, G.711/722/723.1/726, GSM, iLBC, Codec 2, Speex, every ADPCM variant, IAMF and every raw PCM flavour.
- **Native DSD encoding: DSF and DFF.** FFmpeg can't write DSD, so IRIDIA has its own 1-bit sigma-delta modulator (5th or 7th order). It supports **DSD64, DSD128, DSD256 and DSD512** and writes ID3 tags and cover art.
- **Up to 7.1 surround from any stereo CD.** Pick Mono, Stereo, 2.1, 3.0, Quad, 4.1, 5.0, 5.1, 6.1 or 7.1 on a live speaker map. There are three upmix modes:
  - **Smart:** FFmpeg's frequency-domain `surround` filter, with LFE extraction
  - **Matrix:** a classic matrix decode with a low-passed LFE
  - **Front only:** bit-transparent front L/R, with the other channels silent
- **Several formats in one pass.** The disc is read once and every selected format is encoded in parallel.
- **Automatic per-format adaptation.** If a format can't carry the requested layout or sample rate, IRIDIA lowers it automatically and tells you (for example AC-3 → 5.1, MP3 → stereo, Opus → 48 kHz).
- **Sample rates from 8 kHz to 384 kHz** using the SoX resampler (28-bit precision). 44.1 kHz stays bit-perfect.
- **Native Windows CD access** through `DeviceIoControl`, with no external ripper needed:
  - raw CDDA reads
  - TOC and CD-Text
  - drive read-offset correction
  - **Secure mode**, which reads every block twice and compares
  - automatic **de-emphasis** on pre-emphasised discs
- **MusicBrainz lookup:** disc ID, track titles, artists, year and genre, plus cover art from the Cover Art Archive. CD-Text is used as a fallback.
- **Clean output:** a configurable naming template, embedded cover art, `cover.jpg`, an EAC-style extraction log with CRC32 checksums, M3U8 playlists, and an optional **single-file image + CUE sheet**.
- **Portable:** one folder with no installer. Your settings stay next to the executable.

<div align="center">
<img src="docs/screenshots/formats.png" alt="Format browser with 142 presets" width="100%">
</div>

---

## 📦 Download

Grab **`IRIDIA-1.0.0-portable-win64.rar`** from the [Releases](../../releases) page, extract it anywhere and run **`IRIDIA.exe`**.

The archive already contains the **FFmpeg 9.0.2 full build** (gyan.dev) in `ffmpeg\`, so it works straight away.

| Requirement | |
|---|---|
| OS | Windows 10 / 11, 64-bit |
| Drive | Any CD/DVD/BD drive that reads audio CDs |
| Disk space | ~550 MB extracted |
| Internet | Optional: only needed for MusicBrainz metadata and cover art |

---

## 🚀 Usage

1. **Insert an audio CD.** IRIDIA reads the TOC and CD-Text, then queries MusicBrainz.
2. Check or edit the album and track metadata, and pick a cover if you like.
3. Click **Add** and choose one or more output formats. Expand a format to tweak its bitrate, quality, bit depth or DSD rate.
4. Choose a **channel layout** and an **upmix mode**, then a **sample rate**.
5. Set the destination folder and naming template, then press **RIP CD**.

### Naming tokens

`{albumartist}` `{artist}` `{album}` `{title}` `{track}` `{year}` `{genre}` `{disc}` `{format}`

The default is `{albumartist} - {album} [{format}]/{track} - {title}`.

### Drive read offset

For accurate rips, enter your drive's read offset in **Settings → Extraction**. You can find it in the [AccurateRip drive offset list](http://www.accuraterip.com/driveoffsets.htm).

---

## 🎚️ Format catalog

| Family | Presets |
|---|---|
| **Lossless** | FLAC (+Ogg, MKA, MP4), ALAC (M4A, CAF), WavPack, TTA (+MKA), MLP, Dolby TrueHD (+MKA), IAMF-FLAC |
| **DSD** | DSF (up to 5.1, as the spec allows), DFF/DSDIFF (up to 7.1). DSD64/128/256/512, 5th/7th-order modulator |
| **Uncompressed** | WAV, RF64, W64, AIFF/AIFF-C, CAF, AU, MKA, MOV, MP4 (ipcm), NUT, AVI, MXF OP-Atom, SoX, IRCAM, VOC, D-Cinema 302, SMPTE 302M, DVD LPCM, Blu-ray LPCM, Nintendo AST, Archimedes VIDC, Lego RSO |
| **Raw PCM** | All 25 `pcm_*` encoders (8/16/24/32/64-bit, signed/unsigned/float, LE/BE, planar) |
| **Lossy** | MP3 (LAME, Shine, MF), AAC (M4A, ADTS, LATM, 3GP, 3G2, M4B, MKA, MF), Opus (libopus, native, WebM, IAMF), Vorbis (libvorbis, native, WebM), AC-3 (+fixed, MF, S/PDIF, MKA), E-AC-3, DTS (+DTS-CD WAV), MP2 (native, fixed, TwoLAME), WMA 1/2, LC3, aptX, aptX HD, SBC, Nellymoser, RealAudio 14.4, DFPWM, MP3-in-WAV, Yamaha SMAF |
| **Speech & telephony** | AMR-NB, AMR-WB, AMR-3GP, G.711 A-law/µ-law (WAV & raw), G.722 (+WAV), G.723.1, G.726 (BE/LE/WAV), GSM, GSM-MS, iLBC, Codec 2 (+raw), Speex, RFC 3389 comfort noise |
| **ADPCM & retro** | MS ADPCM, IMA WAV, IMA QuickTime (AIFF-C, MOV), Yamaha, SWF ADPCM, MP3-in-SWF, CRI ADX, Argonaut ASF, HV ALP, Ubisoft APM, KVAG, Westwood AUD, id RoQ, AMV, Loki SMJPEG, SEGA FILM, Windows WTV |

Every preset was test-encoded with the bundled Windows FFmpeg 9.0.2 build, including every option value, and the channel layouts × upmix modes were swept with the FFmpeg 9.0.2 Linux build.

> The three *Media Foundation* presets (`aac_mf`, `mp3_mf`, `ac3_mf`) use encoders that come with Windows itself. They don't run on the Linux test machine, so they haven't been tested yet.

---

## 🔬 About the DSD engine

```
CD PCM 44.1 kHz ─▶ FFmpeg (upmix + SoX resample → 705.6 kHz float)
                ─▶ linear ×4…×32 interpolation
                ─▶ error-feedback ΣΔ modulator, 1 thread per channel
                ─▶ DSF (LSB-first, 4096-byte blocks, ID3v2) / DFF (DSDIFF 1.5, DIIN + ID3)
```

- The noise-transfer function uses Legendre-optimised zeros in the 0–22 kHz band and Butterworth poles with H∞ = 1.5.
- Simulated in-band SNR (1 kHz tone at −6 dB, DSD64): **≈117 dB** for the 5th-order modulator and **≈135 dB** for the 7th-order one.
- Gain follows the SACD reference: 0 dBFS PCM = 50 % modulation. A built-in overload guard resets the modulator if it ever saturates.

---

## 🛠️ Building from source

```bash
git clone https://github.com/realauthorfilms/iridia.git
cd iridia
npm install
npm start                       # run in development
IRIDIA_DEMO=1 npm start         # virtual disc, no CD drive needed
```

**Portable Windows build** (from Linux or WSL, needs `rar` and `wine` for the exe icon):

```bash
FFDIR=/path/to/ffmpeg-9.0.2-full_build ./tools/build-win.sh
```

**Test suites:**

```bash
npm run test:catalog -- '' --all-opts   # encodes every preset & option with ffmpeg.exe (wine)
npm run test:dsd                        # DSF/DFF encode + decode verification
node tools/test_rip.js                  # full rip pipeline on the virtual disc
```

### Project layout

```
src/
├─ main.js            Electron main process, IPC, settings, FFmpeg discovery
├─ preload.js         secure renderer bridge
├─ core/
│  ├─ catalog.js      142 output presets + channel layouts
│  ├─ ffargs.js       FFmpeg command builder (upmix, resample, IAMF, cover art)
│  ├─ ripper.js       read-once / encode-many rip engine, log, CUE, M3U
│  ├─ cdrom_win.js    native Windows CDDA access (koffi + DeviceIoControl)
│  ├─ dsd.js          ΣΔ modulator + DSF/DFF writers
│  ├─ dsdencode.js    multi-threaded DSD pipeline
│  ├─ metadata.js     MusicBrainz disc ID, lookup, Cover Art Archive
│  └─ demodrive.js    virtual CD for demos & tests
└─ renderer/          UI (HTML/CSS/JS)
```

---

## ❓ FAQ

**Why does my 7.1 AC-3 come out as 5.1?**
AC-3 can carry at most 5.1. IRIDIA adapts each format to what it supports, and shows a notice under *Channels*.

**Is upmixed 7.1 "real" surround?**
No. A CD is stereo, so the surround channels are derived from it. *Smart upmix* gives the most natural result. *Front only* keeps the original stereo bit-for-bit on the front L/R.

**Can I use my own FFmpeg?**
Yes. Go to **Settings → FFmpeg** and browse to any `ffmpeg.exe`. Formats whose encoder is missing from that build are greyed out.

**Where are my settings stored?**
In the `IRIDIA-data` folder next to `IRIDIA.exe`. Delete it to reset.

---

## 📜 License

IRIDIA is released under the **GNU GPL v3.0 or later**. See [LICENSE](LICENSE).

The portable release bundles the [FFmpeg](https://ffmpeg.org) 9.0.2 full build by [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (GPLv3). Its license and build information are in `ffmpeg\`. Other components:

- Fonts: Inter and Outfit (SIL OFL 1.1)
- Icons: [Lucide](https://lucide.dev) (ISC)
- Built with [Electron](https://www.electronjs.org) and [koffi](https://koffi.dev)

Metadata comes from [MusicBrainz](https://musicbrainz.org) and the [Cover Art Archive](https://coverartarchive.org).

<div align="center"><sub>Made with 🌈 for people who still love the shine of a compact disc.</sub></div>

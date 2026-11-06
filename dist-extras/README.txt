IRIDIA 1.0.0 — Portable edition for Windows 10/11 (x64)
=========================================================

Every disc. Every format. Every channel.

QUICK START
  1. Extract this whole folder anywhere (USB stick, Desktop, D:\Tools ...).
  2. Run IRIDIA.exe — no installation, no admin rights needed.
  3. Insert an audio CD, pick one or more output formats, choose a channel
     layout (Mono up to 7.1) and press RIP CD.

WHAT'S INSIDE
  IRIDIA.exe            the application
  ffmpeg\ffmpeg.exe     FFmpeg 9.0.2 "full" build (gyan.dev, GPLv3) used for encoding
  IRIDIA-data\          your settings (portable — they stay in this folder)
  LICENSE.txt           GNU GPL v3

FORMATS
  142 output presets covering every audio encoder of FFmpeg 9.0.2 (89 encoders)
  plus IRIDIA's own 1-bit DSD engine for DSF and DFF (DSD64 → DSD512).

TIPS
  • Drive read offset: look up your drive on the AccurateRip drive list and
    enter the value in Settings → Extraction (for example +6 or +667).
  • Formats that cannot carry the requested channel count or sample rate are
    adapted automatically (e.g. AC-3 → 5.1, MP3 → stereo, Opus → 48 kHz).
  • DSD encoding is CPU-heavy: DSD256/512 in 7.1 can be slower than real time.
  • You can point IRIDIA at another FFmpeg build in Settings.

Settings reset: delete the IRIDIA-data folder.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aurora Code is a Next.js application for secure data transmission through visual aurora pattern encoding/decoding. Users can encode secret messages into animated aurora visuals displayed on screen, then decode them by pointing a camera at the display.

## Development Commands

All commands should be executed inside the Docker container:

```bash
# Docker operations (run from host)
make up-build    # Build and start container
make shell       # Enter container shell
make logs        # View container logs
make down        # Stop container

# Inside container (or via make dev/start)
bun run dev      # Development server at http://localhost:4010
bun run build    # Production build
bun run start    # Production server
```

## Architecture

### Data Flow

```
Display Mode (Encoding):
Input String → UTF-8 → RS Encode → 16-byte Frames → 32 Color Bands → WebGL Aurora

Scan Mode (Decoding):
Camera Capture → Aurora Detection → Frame Collection → RS Decode → UTF-8 → Output String
```

### Key Directories

- `lib/encoding/` - Reed-Solomon encoder, CRC-8, Galois field math, frame serialization
- `lib/visual/` - 16-color aurora palette, frame-to-visual mapping
- `lib/detection/` - Camera frame detection, multi-frame decoder
- `components/AuroraCode.tsx` - Main UI component with WebGL rendering

### Frame Protocol

Each frame is 16 bytes:
- Byte 0: Frame index
- Byte 1: Total frames
- Bytes 2-3: Sequence ID
- Bytes 4-13: Data chunk (10 bytes)
- Byte 14: CRC-8 checksum
- Byte 15: Reserved

Reed-Solomon configuration: 80% data frames, 20% parity frames (minimum 4 parity).

### Visual Encoding

- 16-color aurora palette (green → cyan → blue → purple → pink)
- Each frame byte maps to 2 bands (4 bits each = 16 colors)
- 16 bytes/frame = 32 horizontal bands
- Display cycles at 2 FPS

## Tech Stack

- Next.js 16 / React 19 / TypeScript 5.7
- Bun runtime
- WebGL for aurora rendering
- No external crypto libraries (Reed-Solomon, CRC-8, GF(2^8) implemented from scratch)

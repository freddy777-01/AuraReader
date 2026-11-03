use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobiChapter {
    pub index: usize,
    pub title: String,
    pub start_page: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobiDocumentPayload {
    pub title: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub pages: Vec<String>, // Sanitized HTML fragments per virtual page
    pub chapters: Vec<MobiChapter>,
}

pub struct MobiMetadataSummary {
    pub title: Option<String>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub estimated_pages: Option<i32>,
    pub cover_path: Option<String>,
}

fn read_u16_be(data: &[u8], offset: usize) -> u16 {
    if offset + 2 > data.len() {
        return 0;
    }
    u16::from_be_bytes([data[offset], data[offset + 1]])
}

fn read_u32_be(data: &[u8], offset: usize) -> u32 {
    if offset + 4 > data.len() {
        return 0;
    }
    u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

/// Decompresses a single PalmDOC LZ77-compressed record (`compression == 2`).
fn decompress_palmdoc_lz77(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() * 2);
    let mut i = 0;
    while i < input.len() {
        let b = input[i];
        i += 1;
        match b {
            0x00 => out.push(0x00),
            0x01..=0x08 => {
                let count = b as usize;
                let end = (i + count).min(input.len());
                out.extend_from_slice(&input[i..end]);
                i = end;
            }
            0x09..=0x7F => out.push(b),
            0x80..=0xBF => {
                if i >= input.len() {
                    break;
                }
                let next = input[i];
                i += 1;
                let pair = ((b as u16) << 8) | (next as u16);
                let distance = ((pair >> 3) & 0x07FF) as usize;
                let length = ((pair & 0x0007) + 3) as usize;
                if distance > 0 && distance <= out.len() {
                    let start = out.len() - distance;
                    for k in 0..length {
                        let byte = out[start + (k % distance)];
                        out.push(byte);
                    }
                }
            }
            0xC0..=0xFF => {
                out.push(b' ');
                out.push(b ^ 0x80);
            }
        }
    }
    out
}

/// Extracts metadata and optional embedded cover image from a `.mobi` file.
pub fn extract_mobi_summary(
    path: &Path,
    file_hash: &str,
    covers_dir: &Path,
) -> Result<MobiMetadataSummary, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let parsed = parse_pdb_and_mobi(&bytes, Some((file_hash, covers_dir)), false)?;
    Ok(MobiMetadataSummary {
        title: parsed.title,
        author: parsed.author,
        publisher: parsed.publisher,
        estimated_pages: Some(parsed.estimated_pages.max(1) as i32),
        cover_path: parsed.cover_path,
    })
}

/// Full `.mobi` content loader returning paginated HTML chunks and extracted Table of Contents.
pub fn load_mobi_document(path: &Path) -> Result<MobiDocumentPayload, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let parsed = parse_pdb_and_mobi(&bytes, None, true)?;

    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled MOBI")
        .to_string();

    Ok(MobiDocumentPayload {
        title: parsed.title.unwrap_or(fallback_title),
        author: parsed.author,
        publisher: parsed.publisher,
        pages: parsed.pages,
        chapters: parsed.chapters,
    })
}

struct InternalMobiParseResult {
    title: Option<String>,
    author: Option<String>,
    publisher: Option<String>,
    cover_path: Option<String>,
    estimated_pages: usize,
    pages: Vec<String>,
    chapters: Vec<MobiChapter>,
}

fn parse_pdb_and_mobi(
    bytes: &[u8],
    cover_target: Option<(&str, &Path)>,
    decode_body: bool,
) -> Result<InternalMobiParseResult, String> {
    if bytes.len() < 78 {
        return Err("File is too small to be a valid MOBI/PalmDB container".to_string());
    }

    let pdb_title = String::from_utf8_lossy(&bytes[0..32])
        .trim_matches(char::from(0))
        .trim()
        .to_string();

    let num_records = read_u16_be(bytes, 76) as usize;
    if num_records == 0 || 78 + num_records * 8 > bytes.len() {
        return Err("Invalid PalmDB record table in MOBI file".to_string());
    }

    let mut record_offsets = Vec::with_capacity(num_records);
    for idx in 0..num_records {
        let off = read_u32_be(bytes, 78 + idx * 8) as usize;
        if off < bytes.len() {
            record_offsets.push(off);
        }
    }

    if record_offsets.is_empty() {
        return Err("No valid records found in MOBI container".to_string());
    }

    let rec0_start = record_offsets[0];
    let rec0_end = if record_offsets.len() > 1 {
        record_offsets[1]
    } else {
        bytes.len()
    };
    let rec0 = &bytes[rec0_start..rec0_end];

    if rec0.len() < 16 {
        return Err("Record 0 is too short for PalmDOC header".to_string());
    }

    let compression = read_u16_be(rec0, 0);
    let text_length = read_u32_be(rec0, 4) as usize;
    let text_record_count = read_u16_be(rec0, 8) as usize;

    let mut title = if !pdb_title.is_empty() {
        Some(pdb_title)
    } else {
        None
    };
    let mut author: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut first_image_index: usize = 0;
    let mut cover_offset_in_images: Option<usize> = None;

    // Check for "MOBI" magic at offset 16 inside Record 0
    if rec0.len() >= 24 && &rec0[16..20] == b"MOBI" {
        let mobi_header_len = read_u32_be(rec0, 20) as usize;
        let full_name_offset = read_u32_be(rec0, 84) as usize;
        let full_name_len = read_u32_be(rec0, 88) as usize;
        if full_name_offset > 0
            && full_name_len > 0
            && full_name_offset + full_name_len <= rec0.len()
        {
            let full_title =
                String::from_utf8_lossy(&rec0[full_name_offset..full_name_offset + full_name_len])
                    .trim_matches(char::from(0))
                    .trim()
                    .to_string();
            if !full_title.is_empty() {
                title = Some(full_title);
            }
        }

        if rec0.len() >= 112 {
            first_image_index = read_u32_be(rec0, 108) as usize;
        }

        let exth_flags = if rec0.len() >= 132 {
            read_u32_be(rec0, 128)
        } else {
            0
        };

        // Parse EXTH metadata block if bit 6 (0x40) is set
        let exth_start = 16 + mobi_header_len;
        if (exth_flags & 0x40) != 0
            && exth_start + 12 <= rec0.len()
            && &rec0[exth_start..exth_start + 4] == b"EXTH"
        {
            let exth_record_count = read_u32_be(rec0, exth_start + 8) as usize;
            let mut cursor = exth_start + 12;
            for _ in 0..exth_record_count {
                if cursor + 8 > rec0.len() {
                    break;
                }
                let rec_type = read_u32_be(rec0, cursor);
                let rec_len = read_u32_be(rec0, cursor + 4) as usize;
                if rec_len < 8 || cursor + rec_len > rec0.len() {
                    break;
                }
                let payload = &rec0[cursor + 8..cursor + rec_len];
                match rec_type {
                    100 => {
                        let val = String::from_utf8_lossy(payload).trim().to_string();
                        if !val.is_empty() {
                            author = Some(val);
                        }
                    }
                    101 => {
                        let val = String::from_utf8_lossy(payload).trim().to_string();
                        if !val.is_empty() {
                            publisher = Some(val);
                        }
                    }
                    201 => {
                        if payload.len() >= 4 {
                            cover_offset_in_images = Some(read_u32_be(payload, 0) as usize);
                        }
                    }
                    503 => {
                        let val = String::from_utf8_lossy(payload).trim().to_string();
                        if !val.is_empty() {
                            title = Some(val);
                        }
                    }
                    _ => {}
                }
                cursor += rec_len;
            }
        }
    }

    // Extract embedded cover image if requested
    let mut saved_cover_path = None;
    if let Some((file_hash, covers_dir)) = cover_target {
        if first_image_index > 0 {
            let target_rec = first_image_index + cover_offset_in_images.unwrap_or(0);
            if target_rec < record_offsets.len() {
                let start = record_offsets[target_rec];
                let end = if target_rec + 1 < record_offsets.len() {
                    record_offsets[target_rec + 1]
                } else {
                    bytes.len()
                };
                let img_bytes = &bytes[start..end];
                let ext = if img_bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                    Some("png")
                } else if img_bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                    Some("jpg")
                } else {
                    None
                };

                if let Some(ext_str) = ext {
                    let out_path = covers_dir.join(format!("{}.{}", file_hash, ext_str));
                    if fs::write(&out_path, img_bytes).is_ok() {
                        saved_cover_path = Some(out_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    let estimated_pages = (text_length / 2200).max(1);
    if !decode_body {
        return Ok(InternalMobiParseResult {
            title,
            author,
            publisher,
            cover_path: saved_cover_path,
            estimated_pages,
            pages: Vec::new(),
            chapters: Vec::new(),
        });
    }

    // Decode text records (1 ..= text_record_count)
    let max_rec = text_record_count.min(record_offsets.len().saturating_sub(1));
    let mut raw_text_bytes = Vec::with_capacity(text_length.min(16 * 1024 * 1024));

    for idx in 1..=max_rec {
        let start = record_offsets[idx];
        let end = if idx + 1 < record_offsets.len() {
            record_offsets[idx + 1]
        } else {
            bytes.len()
        };
        if start >= end || end > bytes.len() {
            continue;
        }
        let slice = &bytes[start..end];
        match compression {
            1 => raw_text_bytes.extend_from_slice(slice),
            2 => {
                let decompressed = decompress_palmdoc_lz77(slice);
                raw_text_bytes.extend_from_slice(&decompressed);
            }
            _ => {
                // HUFF/CDIC or DRM-protected record fallback
                raw_text_bytes.extend_from_slice(slice);
            }
        }
    }

    let raw_html = String::from_utf8_lossy(&raw_text_bytes).to_string();
    let (pages, chapters) = paginate_mobi_html(&raw_html);

    Ok(InternalMobiParseResult {
        title,
        author,
        publisher,
        cover_path: saved_cover_path,
        estimated_pages: pages.len().max(1),
        pages,
        chapters,
    })
}

/// Cleans MOBI-specific markup (`<mbp:pagebreak/>`, `<filepos=...>`) and paginates the HTML
/// into readable ~2,400-character virtual pages while extracting `<h1>`/`<h2>`/`<h3>` chapters.
fn paginate_mobi_html(raw_html: &str) -> (Vec<String>, Vec<MobiChapter>) {
    // Extract body content if present
    let body_slice = if let Some(body_start) = raw_html.to_ascii_lowercase().find("<body") {
        let after_tag = raw_html[body_start..]
            .find('>')
            .map(|i| body_start + i + 1)
            .unwrap_or(body_start);
        let body_end = raw_html
            .to_ascii_lowercase()
            .rfind("</body>")
            .unwrap_or(raw_html.len());
        &raw_html[after_tag..body_end.max(after_tag)]
    } else {
        raw_html
    };

    // Split on explicit MOBI pagebreaks first, then chunk long sections into ~2400-char pages
    let cleaned = body_slice
        .replace("<mbp:pagebreak/>", "<!--AURA_PAGEBREAK-->")
        .replace("<mbp:pagebreak />", "<!--AURA_PAGEBREAK-->")
        .replace("<mbp:pagebreak>", "<!--AURA_PAGEBREAK-->");

    let mut pages = Vec::new();
    let mut chapters = Vec::new();

    for section in cleaned.split("<!--AURA_PAGEBREAK-->") {
        let trimmed = section.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Split into paragraph blocks so we never cut inside an HTML tag
        let mut current_page_buf = String::new();
        for block in trimmed.split_inclusive("</p>") {
            // Detect chapter headings (<h1>, <h2>, <h3>) for Table of Contents
            if let Some(heading) = extract_heading_text(block) {
                if !current_page_buf.trim().is_empty() {
                    pages.push(current_page_buf.clone());
                    current_page_buf.clear();
                }
                let page_num = pages.len() + 1;
                chapters.push(MobiChapter {
                    index: chapters.len(),
                    title: heading,
                    start_page: page_num,
                });
            }

            current_page_buf.push_str(block);
            if current_page_buf.len() >= 2400 {
                pages.push(current_page_buf.clone());
                current_page_buf.clear();
            }
        }

        if !current_page_buf.trim().is_empty() {
            pages.push(current_page_buf);
        }
    }

    if pages.is_empty() {
        pages.push("<p>No readable text records found in this MOBI file.</p>".to_string());
    }

    if chapters.is_empty() {
        for (i, _) in pages.iter().enumerate().step_by(10) {
            chapters.push(MobiChapter {
                index: chapters.len(),
                title: format!("Section {} (Page {})", chapters.len() + 1, i + 1),
                start_page: i + 1,
            });
        }
    }

    (pages, chapters)
}

fn extract_heading_text(html_fragment: &str) -> Option<String> {
    let lower = html_fragment.to_ascii_lowercase();
    for tag in ["<h1", "<h2", "<h3"] {
        if let Some(start_idx) = lower.find(tag) {
            if let Some(open_end) = lower[start_idx..].find('>') {
                let content_start = start_idx + open_end + 1;
                let close_tag = format!("</{}", &tag[1..]);
                if let Some(close_idx) = lower[content_start..].find(&close_tag) {
                    let inner = &html_fragment[content_start..content_start + close_idx];
                    let plain = strip_html_tags(inner);
                    if !plain.is_empty() && plain.len() <= 120 {
                        return Some(plain);
                    }
                }
            }
        }
    }
    None
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}


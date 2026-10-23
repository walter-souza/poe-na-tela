//! Ícone do app dono de uma janela, usado como prévia quando não dá para capturar a imagem
//! (janela minimizada, conteúdo protegido, etc.).
use base64::{engine::general_purpose::STANDARD, Engine};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassLongPtrW, GetIconInfo, SendMessageTimeoutW, GCLP_HICON, HICON, ICONINFO, ICON_BIG, SMTO_ABORTIFHUNG,
    WM_GETICON,
};

fn window_hicon(hwnd: HWND) -> Option<HICON> {
    unsafe {
        let mut result = 0usize;
        SendMessageTimeoutW(hwnd, WM_GETICON, WPARAM(ICON_BIG as usize), LPARAM(0), SMTO_ABORTIFHUNG, 150, Some(&mut result));
        if result != 0 {
            return Some(HICON(result as *mut _));
        }
        let class_icon = GetClassLongPtrW(hwnd, GCLP_HICON);
        (class_icon != 0).then(|| HICON(class_icon as *mut _))
    }
}

/// Converte o bitmap de cor do ícone em RGBA. Ícones antigos não têm alfa: viram opacos.
unsafe fn icon_rgba(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;
    let color = info.hbmColor;
    let mask = info.hbmMask;
    let result = (|| {
        if color.is_invalid() {
            return None;
        }
        let mut bitmap = BITMAP::default();
        if GetObjectW(HGDIOBJ(color.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bitmap as *mut _ as *mut _)) == 0 {
            return None;
        }
        let (width, height) = (bitmap.bmWidth as u32, bitmap.bmHeight as u32);
        if width == 0 || height == 0 {
            return None;
        }
        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // de cima para baixo
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (width * height * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let lines = GetDIBits(dc, color, 0, height, Some(bgra.as_mut_ptr() as *mut _), &mut header, DIB_RGB_COLORS);
        let _ = DeleteDC(dc);
        if lines == 0 {
            return None;
        }
        let has_alpha = bgra.chunks_exact(4).any(|px| px[3] != 0);
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
            if !has_alpha {
                px[3] = 255;
            }
        }
        Some((width, height, bgra))
    })();
    let _ = DeleteObject(HGDIOBJ(color.0));
    let _ = DeleteObject(HGDIOBJ(mask.0));
    result
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().ok()?.write_image_data(rgba).ok()?;
    Some(out)
}

/// Ícone da janela como `data:image/png;base64,...`, ou erro se o app não expõe ícone.
#[tauri::command]
pub fn window_icon(hwnd: u64) -> Result<String, String> {
    let hwnd = HWND(hwnd as usize as *mut _);
    let icon = window_hicon(hwnd).ok_or("a janela não tem ícone")?;
    let (width, height, rgba) = unsafe { icon_rgba(icon) }.ok_or("não foi possível ler o ícone")?;
    let png = encode_png(width, height, &rgba).ok_or("falha ao codificar o ícone")?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_valido_a_partir_de_rgba() {
        let png = encode_png(2, 2, &[255; 16]).unwrap();
        assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G']);
    }
}

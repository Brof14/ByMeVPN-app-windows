// Window proportions follow the Android single-column layout. Keep first launch
// inside 70% of the monitor's *work area*, not 70% of total screen pixels.
const MAX_MONITOR_SHARE: f64 = 0.70;
const TARGET_WIDTH: f64 = 480.0;
const TARGET_HEIGHT: f64 = 720.0;

fn initial_window_size(work_width: f64, work_height: f64) -> (f64, f64) {
    (
        TARGET_WIDTH.min((work_width * MAX_MONITOR_SHARE).floor()),
        TARGET_HEIGHT.min((work_height * MAX_MONITOR_SHARE).floor()),
    )
}

pub fn fit_to_monitor(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let work = monitor.work_area();
    let scale = monitor.scale_factor();
    let (width, height) = initial_window_size(
        f64::from(work.size.width) / scale,
        f64::from(work.size.height) / scale,
    );
    // A small screen must not inherit a minimum larger than its available area.
    window.set_min_size(Some(tauri::LogicalSize::new(
        width.min(320.0),
        height.min(320.0),
    )))?;
    window.set_size(tauri::LogicalSize::new(width, height))?;
    window.center()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_portrait_window_stays_under_seventy_percent() {
        for (width, height) in [
            (1920.0, 1040.0),
            (1366.0, 728.0),
            (1024.0, 728.0),
            (640.0, 360.0),
        ] {
            let (window_w, window_h) = initial_window_size(width, height);
            assert!(window_w <= width * MAX_MONITOR_SHARE);
            assert!(window_h <= height * MAX_MONITOR_SHARE);
            assert!(window_w <= TARGET_WIDTH && window_h <= TARGET_HEIGHT);
        }
    }

    #[test]
    fn tall_desktop_keeps_an_android_like_portrait_canvas() {
        assert_eq!(initial_window_size(1920.0, 1040.0), (480.0, 720.0));
        assert_eq!(initial_window_size(1366.0, 728.0), (480.0, 509.0));
    }
}

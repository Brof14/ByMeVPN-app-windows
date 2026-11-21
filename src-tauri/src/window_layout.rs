// Desktop initial size follows the Android visual language without forcing
// a phone viewport. Never cover more than 70% of the monitor's usable *area*.
const MAX_MONITOR_AREA_SHARE: f64 = 0.70;
const MAX_MONITOR_AXIS_SHARE: f64 = 0.90;
// 1080x720 opens the desktop two-column workspace instead of a tablet-width
// column on large monitors; fit_to_monitor still shrinks it on small screens.
const TARGET_WIDTH: f64 = 1080.0;
const TARGET_HEIGHT: f64 = 720.0;

// Pure geometry is independently tested; Windows DPI scaling is handled once
// at the boundary in fit_to_monitor.
fn initial_window_size(work_width: f64, work_height: f64) -> (f64, f64) {
    let area_scale = ((MAX_MONITOR_AREA_SHARE * work_width * work_height)
        / (TARGET_WIDTH * TARGET_HEIGHT))
        .sqrt();
    let scale = 1.0_f64
        .min(area_scale)
        .min(MAX_MONITOR_AXIS_SHARE * work_width / TARGET_WIDTH)
        .min(MAX_MONITOR_AXIS_SHARE * work_height / TARGET_HEIGHT);
    (
        (TARGET_WIDTH * scale).floor(),
        (TARGET_HEIGHT * scale).floor(),
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
    window.set_min_size(Some(tauri::LogicalSize::new(
        width.min(600.0),
        height.min(420.0),
    )))?;
    window.set_size(tauri::LogicalSize::new(width, height))?;
    window.center()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_window_is_wide_without_occupying_more_than_seventy_percent_of_work_area() {
        for (width, height) in [
            (1920.0, 1040.0),
            (1366.0, 728.0),
            (1024.0, 728.0),
            (640.0, 360.0),
        ] {
            let (window_w, window_h) = initial_window_size(width, height);
            assert!(window_w * window_h <= MAX_MONITOR_AREA_SHARE * width * height);
            assert!(window_w <= MAX_MONITOR_AXIS_SHARE * width);
            assert!(window_h <= MAX_MONITOR_AXIS_SHARE * height);
            assert!(
                window_w > window_h,
                "Desktop first-launch should be landscape"
            );
        }
    }

    #[test]
    fn desktop_default_is_readable_not_a_phone_sized_viewport() {
        assert_eq!(initial_window_size(1920.0, 1080.0), (1080.0, 720.0));
        let (w, h) = initial_window_size(1366.0, 728.0);
        assert!(w >= 900.0 && h >= 620.0);
    }
}

//! Desktop shell for Kozue. The app itself lives in the web view; this side
//! only provides what a web page cannot do: reading and writing files by
//! path, windows, the macOS menu bar and "open with" integration.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request, Response};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct OpenState {
    /// Files the OS asked us to open that no window has picked up yet.
    queue: Mutex<Vec<String>>,
    /// The file a particular window was created for.
    per_window: Mutex<HashMap<String, String>>,
}

static MAIN_CREATED: AtomicBool = AtomicBool::new(false);
static NEXT_WINDOW: AtomicU32 = AtomicU32::new(2);

// ------------------------------------------------------------------ files

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

/// Writes through a temporary file so a crash never leaves a half-written document.
fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".{}.tmp", std::process::id()));
    let tmp = PathBuf::from(tmp);
    let staged = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if staged.is_err() {
        // E.g. the folder is read-only but the file itself is writable.
        let _ = std::fs::remove_file(&tmp);
        return std::fs::write(path, data);
    }
    Ok(())
}

/// Body layout: `[u32 LE path length][path, UTF-8][file contents]`.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let owned: Vec<u8>;
    let body: &[u8] = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        // Fallback transport: the bytes arrive as a JSON array of numbers.
        InvokeBody::Json(serde_json::Value::Array(items)) => {
            owned = items
                .iter()
                .map(|v| v.as_u64().unwrap_or(0) as u8)
                .collect();
            &owned
        }
        _ => return Err("unexpected payload".into()),
    };
    if body.len() < 4 {
        return Err("truncated payload".into());
    }
    let n = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    let rest = &body[4..];
    if rest.len() < n {
        return Err("truncated payload".into());
    }
    let path = std::str::from_utf8(&rest[..n]).map_err(|e| e.to_string())?;
    write_atomic(Path::new(path), &rest[n..]).map_err(|e| format!("{path}: {e}"))
}

/// True when something already exists at `path` (used to avoid overwriting when exporting several files).
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

// ---------------------------------------------------------------- windows

fn create_window(app: &AppHandle, file: Option<String>) -> tauri::Result<WebviewWindow> {
    // Only the very first window is "main": it is the one that restores the last session.
    let label = if MAIN_CREATED.swap(true, Ordering::SeqCst) {
        format!("w{}", NEXT_WINDOW.fetch_add(1, Ordering::SeqCst))
    } else {
        "main".to_string()
    };
    if let Some(file) = file {
        app.state::<OpenState>()
            .per_window
            .lock()
            .unwrap()
            .insert(label.clone(), file);
    }
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Kozue")
        .inner_size(1180.0, 780.0)
        .min_inner_size(560.0, 400.0)
        // A smoke test gets a private, in-memory web data store, so it can neither
        // read nor change the real session (drafts, preferences) of the person using the app.
        .incognito(selftest_dir().is_some());
    // The toolbar doubles as the title bar; the window buttons float over it.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 24.0));
    builder.build()
}

/// The window that should receive menu commands and open requests.
#[cfg(target_os = "macos")]
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())
        .cloned()
}

#[tauri::command]
async fn new_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
    create_window(&app, path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The file this window should show at startup, if any.
#[tauri::command]
fn initial_file(window: tauri::Window, state: tauri::State<'_, OpenState>) -> Option<String> {
    if let Some(path) = state.per_window.lock().unwrap().remove(window.label()) {
        return Some(path);
    }
    let mut queue = state.queue.lock().unwrap();
    if queue.is_empty() {
        None
    } else {
        Some(queue.remove(0))
    }
}

#[tauri::command]
fn take_open_requests(state: tauri::State<'_, OpenState>) -> Vec<String> {
    std::mem::take(&mut *state.queue.lock().unwrap())
}

// ------------------------------------------------------------- smoke test

/// Directory for the self-test results when launched with `KOZUE_SELFTEST=<dir>`.
#[tauri::command]
fn selftest_dir() -> Option<String> {
    std::env::var("KOZUE_SELFTEST")
        .ok()
        .filter(|s| !s.is_empty())
}

/// ZEN mode: the window fills the screen while it is on.
#[tauri::command]
fn set_fullscreen(window: tauri::Window, on: bool) -> Result<(), String> {
    window.set_fullscreen(on).map_err(|e| e.to_string())
}

/// Ends a self-test run. Does nothing during normal use.
#[tauri::command]
fn exit_app(app: AppHandle, code: i32) {
    if selftest_dir().is_some() {
        app.exit(code);
    }
}

// ------------------------------------------------------------------- menu

#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let ja = lang.starts_with("ja");
    let t = |en: &'static str, jp: &'static str| if ja { jp } else { en };
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accelerator {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Kozue")
        .item(&item("about", t("About Kozue", "Kozue について"), None)?)
        .separator()
        .item(&PredefinedMenuItem::services(
            app,
            Some(t("Services", "サービス")),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(
            app,
            Some(t("Hide Kozue", "Kozue を非表示")),
        )?)
        .item(&PredefinedMenuItem::hide_others(
            app,
            Some(t("Hide Others", "ほかを非表示")),
        )?)
        .item(&PredefinedMenuItem::show_all(
            app,
            Some(t("Show All", "すべてを表示")),
        )?)
        .separator()
        .item(&item(
            "quit",
            t("Quit Kozue", "Kozue を終了"),
            Some("CmdOrCtrl+Q"),
        )?)
        .build()?;

    let export = SubmenuBuilder::new(app, t("Export", "書き出し"))
        .item(&item("export.png", t("PNG Image…", "PNG 画像…"), None)?)
        .item(&item("export.jpeg", t("JPEG Image…", "JPEG 画像…"), None)?)
        .item(&item("export.svg", t("SVG Image…", "SVG 画像…"), None)?)
        .item(&item("export.pdf", "PDF…", None)?)
        .separator()
        .item(&item("export.md", "Markdown…", None)?)
        .item(&item(
            "export.txt",
            t("Text Outline…", "テキスト (アウトライン)…"),
            None,
        )?)
        .item(&item("export.opml", "OPML…", None)?)
        .item(&item("export.xmind", "Xmind…", None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, t("File", "ファイル"))
        .item(&item(
            "new",
            t("New Map", "新規マップ"),
            Some("CmdOrCtrl+N"),
        )?)
        .item(&item(
            "newWindow",
            t("New Window", "新規ウインドウ"),
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&item("open", t("Open…", "開く…"), Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("save", t("Save", "保存"), Some("CmdOrCtrl+S"))?)
        .item(&item(
            "saveAs",
            t("Save As…", "名前を付けて保存…"),
            Some("CmdOrCtrl+Shift+S"),
        )?)
        .item(&export)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some(t("Close Window", "ウインドウを閉じる")),
        )?)
        .build()?;

    // Undo / redo / select all are routed to the page, which knows whether a
    // text field or the map should handle them. Clipboard items stay native.
    let edit = SubmenuBuilder::new(app, t("Edit", "編集"))
        .item(&item("undo", t("Undo", "取り消す"), Some("CmdOrCtrl+Z"))?)
        .item(&item(
            "redo",
            t("Redo", "やり直す"),
            Some("CmdOrCtrl+Shift+Z"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(t("Cut", "カット")))?)
        .item(&PredefinedMenuItem::copy(app, Some(t("Copy", "コピー")))?)
        .item(&PredefinedMenuItem::paste(
            app,
            Some(t("Paste", "ペースト")),
        )?)
        .item(&item(
            "duplicate",
            t("Duplicate", "複製"),
            Some("CmdOrCtrl+D"),
        )?)
        .item(&item("delete", t("Delete", "削除"), None)?)
        .item(&item(
            "deleteSingle",
            t("Delete Topic Only", "トピックのみ削除"),
            None,
        )?)
        .item(&item(
            "selectAll",
            t("Select All", "すべてを選択"),
            Some("CmdOrCtrl+A"),
        )?)
        .separator()
        .item(&item("search", t("Find…", "検索…"), Some("CmdOrCtrl+F"))?)
        .item(&item(
            "replace",
            t("Find and Replace…", "検索と置換…"),
            Some("CmdOrCtrl+Alt+F"),
        )?)
        .build()?;

    let style = SubmenuBuilder::new(app, t("Style", "スタイル"))
        .item(&item(
            "important",
            t("Important", "重要"),
            Some("CmdOrCtrl+Shift+1"),
        )?)
        .item(&item(
            "crossed",
            t("Crossed Out", "取り消し"),
            Some("CmdOrCtrl+Shift+2"),
        )?)
        .separator()
        .item(&item("bold", t("Bold", "太字"), Some("CmdOrCtrl+B"))?)
        .item(&item(
            "italic",
            t("Italic", "斜体"),
            Some("CmdOrCtrl+Shift+I"),
        )?)
        .item(&item(
            "strike",
            t("Strikethrough", "取り消し線"),
            Some("CmdOrCtrl+Shift+X"),
        )?)
        .separator()
        .item(&item(
            "copyStyle",
            t("Copy Style", "スタイルをコピー"),
            Some("CmdOrCtrl+Alt+C"),
        )?)
        .item(&item(
            "pasteStyle",
            t("Paste Style", "スタイルをペースト"),
            Some("CmdOrCtrl+Alt+V"),
        )?)
        .item(&item(
            "styleToLevel",
            t("Apply to Same Level", "同じ階層のトピックに適用"),
            None,
        )?)
        .separator()
        .item(&item(
            "resetStyle",
            t("Reset Style", "スタイルをリセット"),
            None,
        )?)
        .item(&item(
            "editStyle",
            t("More Styles…", "スタイルを設定…"),
            None,
        )?)
        .build()?;

    let topic = SubmenuBuilder::new(app, t("Topic", "トピック"))
        .item(&item("addSibling", t("Add Topic", "トピックを追加"), None)?)
        .item(&item(
            "addSiblingBefore",
            t("Add Topic Before", "前にトピックを追加"),
            None,
        )?)
        .item(&item(
            "addChild",
            t("Add Subtopic", "サブトピックを追加"),
            None,
        )?)
        .item(&item(
            "addParent",
            t("Insert Parent Topic", "親トピックを挿入"),
            Some("CmdOrCtrl+Enter"),
        )?)
        .separator()
        .item(&item(
            "relationship",
            t("Relationship", "関連線"),
            Some("CmdOrCtrl+Shift+L"),
        )?)
        .item(&item(
            "boundary",
            t("Boundary", "囲み"),
            Some("CmdOrCtrl+Shift+B"),
        )?)
        .item(&item("summary", t("Summary", "要約"), None)?)
        .separator()
        .item(&item("todo", "To-Do", Some("CmdOrCtrl+Shift+D"))?)
        .item(&item("editLabels", t("Labels…", "ラベル…"), None)?)
        .item(&item("editNote", t("Note…", "ノート…"), None)?)
        .item(&item(
            "editLink",
            t("Link…", "リンク…"),
            Some("CmdOrCtrl+K"),
        )?)
        .item(&style)
        .separator()
        .item(&item(
            "sheet.fromTopic",
            t("New Sheet from Topic", "トピックから新規シート"),
            None,
        )?)
        .separator()
        .item(&item(
            "toggleCollapse",
            t("Collapse / Expand", "折りたたむ / 展開"),
            Some("CmdOrCtrl+/"),
        )?)
        .item(&item("expandAll", t("Expand All", "すべて展開"), None)?)
        .item(&item(
            "collapseAll",
            t("Collapse All", "すべて折りたたむ"),
            None,
        )?)
        .build()?;

    let structure = SubmenuBuilder::new(app, t("Structure", "構造"))
        .item(&item("layout.map", t("Mind Map", "マインドマップ"), None)?)
        .item(&item(
            "layout.logic",
            t("Logic Chart (Right)", "ロジックチャート (右)"),
            None,
        )?)
        .item(&item(
            "layout.logic-left",
            t("Logic Chart (Left)", "ロジックチャート (左)"),
            None,
        )?)
        .item(&item(
            "layout.brace",
            t("Brace Map", "ブレースマップ"),
            None,
        )?)
        .separator()
        .item(&item(
            "layout.org",
            t("Org Chart (Down)", "組織図 (下)"),
            None,
        )?)
        .item(&item(
            "layout.org-up",
            t("Org Chart (Up)", "組織図 (上)"),
            None,
        )?)
        .item(&item(
            "layout.org-tree",
            t("Org Chart (Tree)", "組織図 (ツリー)"),
            None,
        )?)
        .item(&item(
            "layout.tree",
            t("Tree Chart", "ツリーチャート"),
            None,
        )?)
        .separator()
        .item(&item(
            "layout.timeline",
            t("Timeline (Horizontal)", "タイムライン (横)"),
            None,
        )?)
        .item(&item(
            "layout.timeline-v",
            t("Timeline (Vertical)", "タイムライン (縦)"),
            None,
        )?)
        .item(&item(
            "layout.fishbone",
            t("Fishbone (Head Left)", "フィッシュボーン (左向き)"),
            None,
        )?)
        .item(&item(
            "layout.fishbone-right",
            t("Fishbone (Head Right)", "フィッシュボーン (右向き)"),
            None,
        )?)
        .build()?;

    let sheet = SubmenuBuilder::new(app, t("Sheet", "シート"))
        .item(&item("sheet.new", t("New Sheet", "新規シート"), None)?)
        .item(&item("sheet.rename", t("Rename…", "名前を変更…"), None)?)
        .item(&item(
            "sheet.duplicate",
            t("Duplicate Sheet", "シートを複製"),
            None,
        )?)
        .item(&item(
            "sheet.delete",
            t("Delete Sheet", "シートを削除"),
            None,
        )?)
        .separator()
        .item(&item(
            "sheet.next",
            t("Next Sheet", "次のシート"),
            Some("CmdOrCtrl+Shift+]"),
        )?)
        .item(&item(
            "sheet.prev",
            t("Previous Sheet", "前のシート"),
            Some("CmdOrCtrl+Shift+["),
        )?)
        .build()?;

    let view = SubmenuBuilder::new(app, t("View", "表示"))
        .item(&structure)
        .item(&sheet)
        .item(&item(
            "zen",
            t("ZEN Mode", "ZEN モード"),
            Some("CmdOrCtrl+Shift+F"),
        )?)
        .item(&item(
            "focusBranch",
            t(
                "Show Branch Only / Whole Map",
                "ブランチのみ表示 / マップ全体",
            ),
            Some("CmdOrCtrl+;"),
        )?)
        .separator()
        .item(&item("zoomIn", t("Zoom In", "拡大"), Some("CmdOrCtrl+="))?)
        .item(&item(
            "zoomOut",
            t("Zoom Out", "縮小"),
            Some("CmdOrCtrl+-"),
        )?)
        .item(&item(
            "zoomReset",
            t("Actual Size", "実際のサイズ"),
            Some("CmdOrCtrl+0"),
        )?)
        .item(&item(
            "fit",
            t("Zoom to Fit", "全体を表示"),
            Some("CmdOrCtrl+1"),
        )?)
        .item(&item(
            "centerRoot",
            t("Go to Central Topic", "中心トピックへ移動"),
            None,
        )?)
        .separator()
        .item(&item(
            "togglePanel",
            t("Format Panel", "フォーマットパネル"),
            Some("CmdOrCtrl+I"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(t("Enter Full Screen", "フルスクリーン")),
        )?)
        .build()?;

    let window = SubmenuBuilder::new(app, t("Window", "ウインドウ"))
        .item(&PredefinedMenuItem::minimize(
            app,
            Some(t("Minimize", "しまう")),
        )?)
        .item(&PredefinedMenuItem::maximize(
            app,
            Some(t("Zoom", "拡大／縮小")),
        )?)
        .build()?;

    let help = SubmenuBuilder::new(app, t("Help", "ヘルプ"))
        .item(&item(
            "shortcuts",
            t("Keyboard Shortcuts", "キーボードショートカット"),
            None,
        )?)
        .item(&item(
            "welcome",
            t("Open the Welcome Map", "ようこそマップを開く"),
            None,
        )?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &topic, &view, &window, &help])
        .build()
}

/// Rebuilds the menu bar in the language chosen inside the app.
#[tauri::command]
fn set_menu_language(app: AppHandle, lang: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let menu = build_menu(&app, &lang).map_err(|e| e.to_string())?;
        app.set_menu(menu).map_err(|e| e.to_string())?;
    }
    let _ = (&app, &lang);
    Ok(())
}

#[cfg(target_os = "macos")]
fn on_menu(app: &AppHandle, id: &str) {
    match id {
        // Closing each window lets it ask about unsaved changes; the app exits with the last one.
        "quit" => {
            for window in app.webview_windows().values() {
                let _ = window.close();
            }
        }
        "newWindow" => {
            let _ = create_window(app, None);
        }
        _ => {
            if let Some(window) = target_window(app) {
                let _ = app.emit_to(window.label(), "menu", id);
            }
        }
    }
}

// -------------------------------------------------------------------- run

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenState::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            path_exists,
            new_window,
            initial_file,
            take_open_requests,
            set_menu_language,
            selftest_dir,
            set_fullscreen,
            exit_app
        ])
        .setup(|app| {
            // Files passed on the command line ("Open with" on Windows and Linux).
            let mut files = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .filter_map(|a| std::path::absolute(&a).ok())
                .filter(|p| p.is_file())
                .map(|p| p.to_string_lossy().into_owned());
            let first = files.next();
            app.state::<OpenState>().queue.lock().unwrap().extend(files);

            #[cfg(target_os = "macos")]
            {
                let handle = app.handle();
                app.set_menu(build_menu(handle, "en")?)?;
                app.on_menu_event(|app, event| on_menu(app, event.id().0.as_str()));
            }
            create_window(app.handle(), first)?;
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            // Finder double-click / "Open With" while the app is running or starting.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    app.state::<OpenState>().queue.lock().unwrap().extend(paths);
                    if let Some(window) = target_window(app) {
                        let _ = app.emit_to(window.label(), "open-request", ());
                    }
                }
            }
            let _ = (app, event);
        });
}

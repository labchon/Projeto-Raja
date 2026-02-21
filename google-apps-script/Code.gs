const SPREADSHEET_ID = "1qrjivLRww78hlcLTgzmcy9JJt-pRTTlvR63oNs8n43U";
const CONSENT_SHEET = "Consentimentos";
const OBS_SHEET = "Observacoes";
const LOG_SHEET = "Logs";
const DRIVE_FOLDER_ID = "1vfAnXFoeShqLqyi-hbXKpZnfuDIKL1jo"; // opcional, pode deixar vazio

function doGet(_e) {
  return json_({
    ok: true,
    message: "Raja Apps Script online",
    timestamp: new Date().toISOString(),
  });
}

function doPost(e) {
  const requestId = Utilities.getUuid();
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!raw) throw new Error("Empty request body.");

    const payload = JSON.parse(raw);
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    log_(spreadsheet, requestId, "received", payload.type || "unknown", "");

    if (payload.type === "consent") {
      const sheet = getOrCreateSheet_(spreadsheet, CONSENT_SHEET, [
        "request_id",
        "received_at",
        "language",
        "full_name",
        "email",
        "accepted",
        "accepted_at",
      ]);

      sheet.appendRow([
        requestId,
        new Date(),
        payload.language || "",
        payload.fullName || "",
        payload.email || "",
        payload.accepted ? "TRUE" : "FALSE",
        payload.acceptedAt || "",
      ]);

      log_(spreadsheet, requestId, "stored", "consent", "");
      return json_({ ok: true, confirmed: true, type: "consent", requestId: requestId });
    }

    if (payload.type === "observation") {
      const sheet = getOrCreateSheet_(spreadsheet, OBS_SHEET, [
        "request_id",
        "received_at",
        "language",
        "observer_name",
        "observer_email",
        "popular_name",
        "scientific_name",
        "location",
        "sex",
        "observed_at",
        "notes",
        "photo_count",
        "photo_urls",
      ]);

      const rowValues = [
        requestId,
        new Date(),
        payload.language || "",
        payload.observerName || "",
        payload.observerEmail || "",
        payload.popularName || "",
        payload.scientificName || "",
        payload.location || "",
        payload.sex || "",
        payload.observedAt || "",
        payload.notes || "",
        Number(payload.photoCount || 0),
        "PROCESSING",
      ];
      sheet.appendRow(rowValues);
      const rowIndex = sheet.getLastRow();

      let photoUrls = [];
      let photoError = "";
      try {
        photoUrls = savePhotos_(payload.photos || [], requestId);
      } catch (err) {
        photoError = String(err.message || err);
        log_(spreadsheet, requestId, "photo_error", "observation", photoError);
      }

      const photoUrlsValue = photoError
        ? `ERROR: ${photoError}`
        : photoUrls.join(" | ");
      const effectivePhotoCount = photoUrls.length || Number(payload.photoCount || 0);
      sheet.getRange(rowIndex, 12).setValue(effectivePhotoCount);
      sheet.getRange(rowIndex, 13).setValue(photoUrlsValue);

      log_(spreadsheet, requestId, "stored", "observation", `photosSaved=${photoUrls.length}${photoError ? " with photo_error" : ""}`);
      return json_({
        ok: true,
        confirmed: true,
        type: "observation",
        requestId: requestId,
        photosSaved: photoUrls.length,
      });
    }

    log_(spreadsheet, requestId, "ignored", payload.type || "unknown", "Invalid payload type.");
    return json_({ ok: false, confirmed: false, error: "Invalid payload type.", requestId: requestId });
  } catch (error) {
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
      log_(spreadsheet, requestId, "error", "exception", String(error.message || error));
    } catch (_ignored) {}
    return json_({ ok: false, confirmed: false, error: String(error.message || error), requestId: requestId });
  }
}

function savePhotos_(photos, requestId) {
  if (!DRIVE_FOLDER_ID) return photos.map((p) => p.name || "").filter(Boolean);

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const savedUrls = [];

  photos.forEach((photo, index) => {
    if (!photo.dataUrl) return;

    const parts = String(photo.dataUrl).split(",");
    if (parts.length < 2) return;

    const meta = parts[0];
    const base64 = parts[1];
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || photo.type || "image/jpeg";
    const bytes = Utilities.base64Decode(base64);
    const ext = mime.split("/")[1] || "jpg";
    const safeName = photo.name || `raja_photo_${index}.${ext}`;
    const filename = `${requestId}_${safeName}`;

    const blob = Utilities.newBlob(bytes, mime, filename);
    const file = folder.createFile(blob);
    savedUrls.push(file.getUrl());
  });

  return savedUrls;
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(headers);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function log_(spreadsheet, requestId, stage, type, details) {
  const sheet = getOrCreateSheet_(spreadsheet, LOG_SHEET, [
    "logged_at",
    "request_id",
    "stage",
    "type",
    "details",
  ]);
  sheet.appendRow([new Date(), requestId, stage, type, details || ""]);
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

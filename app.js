const SHEET_ENDPOINT = window.RAJA_CONFIG?.sheetEndpoint || "";

const langButtons = document.querySelectorAll("[data-lang-btn]");
const tabButtons = document.querySelectorAll("[data-tab-btn]");
const consentTab = document.getElementById("consentTab");
const observationTab = document.getElementById("observationTab");
const continueBtn = document.getElementById("continueBtn");
const consentCheckPt = document.getElementById("consentCheckPt");
const consentCheckEn = document.getElementById("consentCheckEn");
const consentName = document.getElementById("consentName");
const consentEmail = document.getElementById("consentEmail");
const consentNameEn = document.getElementById("consentNameEn");
const consentEmailEn = document.getElementById("consentEmailEn");
const photoPt = document.getElementById("photo");
const photoEn = document.getElementById("photoEn");
const form = document.getElementById("observationForm");
const feedback = document.getElementById("formFeedback");
const submitButtons = form.querySelectorAll('button[type="submit"]');

let currentLanguage = "pt";
let consentAccepted = false;
let consentLogged = false;
let consentSending = false;
let isSubmittingObservation = false;
let lastObservationSignature = "";
const MAX_IMAGE_DIMENSION = 1280;
const JPEG_QUALITY = 0.72;
const MAX_PHOTO_COUNT = 5;
const MAX_TOTAL_DATAURL_CHARS = 9 * 1024 * 1024;
const SMALL_IMAGE_BYPASS_BYTES = 900 * 1024;

function clearFeedback() {
  feedback.textContent = "";
  feedback.classList.remove("success");
}

function setFeedback(message, isSuccess = false) {
  feedback.textContent = message;
  feedback.classList.toggle("success", isSuccess);
}

function setSubmitButtonsState(disabled) {
  submitButtons.forEach((btn) => {
    btn.disabled = disabled;
  });
}

function setLanguage(lang) {
  currentLanguage = lang;
  document.querySelectorAll(".lang-pt").forEach((el) => el.classList.toggle("hidden", lang !== "pt"));
  document.querySelectorAll(".lang-en").forEach((el) => el.classList.toggle("hidden", lang !== "en"));
  syncLanguageFieldStates(lang);
  langButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.langBtn === lang));
  updateConsentUI();
}

function syncLanguageFieldStates(lang) {
  const ptActive = lang === "pt";
  document
    .querySelectorAll(".lang-pt input, .lang-pt select, .lang-pt textarea, .lang-pt button")
    .forEach((field) => {
      field.disabled = !ptActive;
    });
  document
    .querySelectorAll(".lang-en input, .lang-en select, .lang-en textarea, .lang-en button")
    .forEach((field) => {
      field.disabled = ptActive;
    });
}

function setActiveTab(tabName) {
  const isConsent = tabName === "consent";
  consentTab.classList.toggle("active", isConsent);
  observationTab.classList.toggle("active", !isConsent);
  tabButtons.forEach((btn) => {
    const shouldActivate = btn.dataset.tabBtn === tabName && !btn.classList.contains("hidden");
    btn.classList.toggle("active", shouldActivate);
  });
}

function getActiveConsentName() {
  return (currentLanguage === "pt" ? consentName.value : consentNameEn.value).trim();
}

function getActiveConsentEmail() {
  return (currentLanguage === "pt" ? consentEmail.value : consentEmailEn.value).trim();
}

function getActiveFieldValue(ptId, enId) {
  const ptEl = document.getElementById(ptId);
  const enEl = document.getElementById(enId);
  const value = currentLanguage === "pt" ? ptEl?.value : enEl?.value;
  return (value || "").trim();
}

function getActiveFileInput() {
  return currentLanguage === "pt" ? photoPt : photoEn;
}

function buildObservationSignature() {
  const activePhoto = getActiveFileInput();
  const photoSignature = Array.from(activePhoto?.files || [])
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join("|");

  return [
    currentLanguage,
    getActiveConsentName(),
    getActiveConsentEmail(),
    getActiveFieldValue("popularName", "popularNameEn"),
    getActiveFieldValue("scientificName", "scientificNameEn"),
    getActiveFieldValue("location", "locationEn"),
    currentLanguage === "pt" ? document.getElementById("sex").value : document.getElementById("sexEn").value,
    currentLanguage === "pt" ? document.getElementById("observedAt").value : document.getElementById("observedAtEn").value,
    getActiveFieldValue("notes", "notesEn"),
    photoSignature,
  ].join("::");
}

function updateConsentUI() {
  const checked = currentLanguage === "pt" ? consentCheckPt.checked : consentCheckEn.checked;
  const identityOk = getActiveConsentName() && getActiveConsentEmail();
  consentAccepted = checked && Boolean(identityOk);
  continueBtn.disabled = !consentAccepted;
  continueBtn.textContent = currentLanguage === "pt" ? "Continuar para observação" : "Continue to observation";
}

function getConsentPayload() {
  return {
    type: "consent",
    language: currentLanguage,
    fullName: getActiveConsentName(),
    email: getActiveConsentEmail(),
    accepted: true,
    acceptedAt: new Date().toISOString(),
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Falha ao ler arquivo: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function imageToOptimizedDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    return fileToDataUrl(file);
  }

  // Evita custo de processamento para JPEGs pequenos.
  if ((file.type === "image/jpeg" || file.type === "image/jpg") && file.size <= SMALL_IMAGE_BYPASS_BYTES) {
    return fileToDataUrl(file);
  }

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const maxSide = Math.max(width, height);
    if (maxSide > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / maxSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return fileToDataUrl(file);
  }
}

async function serializeFiles(fileList) {
  const files = Array.from(fileList || []);
  const serialized = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: "image/jpeg",
      size: file.size,
      dataUrl: await imageToOptimizedDataUrl(file),
    })),
  );
  return serialized;
}

async function getObservationPayload() {
  const activePhoto = getActiveFileInput();
  const photos = await serializeFiles(activePhoto?.files);
  const totalDataUrlChars = photos.reduce((acc, photo) => acc + (photo.dataUrl ? photo.dataUrl.length : 0), 0);
  return {
    type: "observation",
    language: currentLanguage,
    observerName: getActiveConsentName(),
    observerEmail: getActiveConsentEmail(),
    popularName: getActiveFieldValue("popularName", "popularNameEn"),
    scientificName: getActiveFieldValue("scientificName", "scientificNameEn"),
    location: getActiveFieldValue("location", "locationEn"),
    sex: currentLanguage === "pt" ? document.getElementById("sex").value : document.getElementById("sexEn").value,
    observedAt: currentLanguage === "pt" ? document.getElementById("observedAt").value : document.getElementById("observedAtEn").value,
    notes: getActiveFieldValue("notes", "notesEn"),
    photoCount: photos.length,
    photos,
    totalDataUrlChars,
    submittedAt: new Date().toISOString(),
  };
}

async function sendToSheet(payload) {
  if (!SHEET_ENDPOINT) return { ok: true, mock: true };

  try {
    // Apps Script frequentemente bloqueia CORS para leitura da resposta.
    // Usamos um envio simples, sem preflight, e consideramos sucesso se a requisicao nao falhar em rede.
    await fetch(SHEET_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: true, confirmed: true, requestId: "" };
  } catch (error) {
    throw new Error(`Falha de rede no envio: ${error?.message || "sem resposta"}.`);
  }
}

langButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.langBtn));
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tabBtn;
    if (tab === "observation" && !consentAccepted) {
      setFeedback(currentLanguage === "pt"
        ? "É necessário aceitar o termo antes de avançar."
        : "You must accept the consent form before continuing.");
      setActiveTab("consent");
      return;
    }
    clearFeedback();
    setActiveTab(tab);
  });
});

consentCheckPt.addEventListener("change", () => {
  if (consentCheckPt.checked) consentCheckEn.checked = true;
  if (!consentCheckPt.checked) consentLogged = false;
  updateConsentUI();
});

consentCheckEn.addEventListener("change", () => {
  if (consentCheckEn.checked) consentCheckPt.checked = true;
  if (!consentCheckEn.checked) consentLogged = false;
  updateConsentUI();
});

consentName.addEventListener("input", () => {
  consentLogged = false;
  updateConsentUI();
});

consentEmail.addEventListener("input", () => {
  consentLogged = false;
  updateConsentUI();
});

consentNameEn.addEventListener("input", () => {
  consentLogged = false;
  updateConsentUI();
});

consentEmailEn.addEventListener("input", () => {
  consentLogged = false;
  updateConsentUI();
});

continueBtn.addEventListener("click", () => {
  if (!consentAccepted) return;
  if (!consentLogged && !consentSending) {
    consentSending = true;
    sendToSheet(getConsentPayload())
      .then((result) => {
        consentLogged = Boolean(result.confirmed);
      })
      .catch(() => {})
      .finally(() => {
        consentSending = false;
      });
  }
  clearFeedback();
  setActiveTab("observation");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmittingObservation) return;
  clearFeedback();

  if (!consentAccepted) {
    setActiveTab("consent");
    setFeedback("Aceite o termo de consentimento para enviar a observação.");
    return;
  }

  const location = currentLanguage === "pt" ? document.getElementById("location") : document.getElementById("locationEn");
  const observedAt = currentLanguage === "pt" ? document.getElementById("observedAt") : document.getElementById("observedAtEn");
  const photo = getActiveFileInput();
  const missingRequired =
    !getActiveConsentName() ||
    !getActiveConsentEmail() ||
    !location.value.trim() ||
    !observedAt.value ||
    !photo.files?.length;

  if (missingRequired) {
    setFeedback("Preencha os campos obrigatórios: nome, e-mail, local, data e foto.");
    return;
  }

  const currentSignature = buildObservationSignature();
  if (currentSignature === lastObservationSignature) {
    setFeedback("Esse preenchimento ja foi enviado. Altere os dados para enviar novamente.");
    return;
  }

  if ((photo.files?.length || 0) > MAX_PHOTO_COUNT) {
    setFeedback(`Envie no máximo ${MAX_PHOTO_COUNT} fotos por observação.`);
    return;
  }

  try {
    isSubmittingObservation = true;
    setSubmitButtonsState(true);
    setFeedback(currentLanguage === "pt" ? "Processando fotos..." : "Processing photos...");
    const payload = await getObservationPayload();
    if (payload.totalDataUrlChars > MAX_TOTAL_DATAURL_CHARS) {
      throw new Error("As fotos estao muito pesadas. Envie menos fotos ou imagens menores.");
    }
    setFeedback(currentLanguage === "pt" ? "Enviando observação..." : "Sending observation...");
    const result = await sendToSheet(payload);
    form.reset();
    if (!SHEET_ENDPOINT) {
      setFeedback("Observação validada. Configure window.RAJA_CONFIG.sheetEndpoint em config.js.");
    } else if (result.confirmed) {
      lastObservationSignature = currentSignature;
      setFeedback(
        currentLanguage === "pt" ? "Sua observação foi salva" : "Your observation has been saved",
        true,
      );
    } else {
      setFeedback(currentLanguage === "pt"
        ? `Envio sem confirmacao. Detalhe: ${result.warning || result.error || "sem resposta do Apps Script"}.`
        : `Submission without confirmation. Detail: ${result.error || "no Apps Script response"}.`);
    }
  } catch (error) {
    setFeedback(error.message);
  } finally {
    isSubmittingObservation = false;
    setSubmitButtonsState(false);
  }
});

setLanguage("pt");
setActiveTab("consent");


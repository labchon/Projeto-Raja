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

let currentLanguage = "pt";
let consentAccepted = false;
let consentLogged = false;

function clearFeedback() {
  feedback.textContent = "";
  feedback.classList.remove("success");
}

function setFeedback(message, isSuccess = false) {
  feedback.textContent = message;
  feedback.classList.toggle("success", isSuccess);
}

function setLanguage(lang) {
  currentLanguage = lang;
  document.querySelectorAll(".lang-pt").forEach((el) => el.classList.toggle("hidden", lang !== "pt"));
  document.querySelectorAll(".lang-en").forEach((el) => el.classList.toggle("hidden", lang !== "en"));
  langButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.langBtn === lang));
  updateConsentUI();
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

function updateConsentUI() {
  const checked = currentLanguage === "pt" ? consentCheckPt.checked : consentCheckEn.checked;
  const identityOk = getActiveConsentName() && getActiveConsentEmail();
  consentAccepted = checked && Boolean(identityOk);
  continueBtn.disabled = !consentAccepted;
  continueBtn.textContent = currentLanguage === "pt" ? "Continuar para observacao" : "Continue to observation";
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

async function serializeFiles(fileList) {
  const files = Array.from(fileList || []);
  const serialized = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })),
  );
  return serialized;
}

async function getObservationPayload() {
  const activePhoto = getActiveFileInput();
  const photos = await serializeFiles(activePhoto?.files);
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
    submittedAt: new Date().toISOString(),
  };
}

async function sendToSheet(payload) {
  if (!SHEET_ENDPOINT) return { ok: true, mock: true };

  try {
    const response = await fetch(SHEET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Falha ao enviar para a planilha (HTTP ${response.status}).`);
    }

    if (data?.ok === false) {
      const suffix = data?.requestId ? ` requestId=${data.requestId}` : "";
      throw new Error(`${data.error || "Erro no Apps Script."}${suffix}`);
    }

    return { ok: true, confirmed: true, requestId: data?.requestId || "" };
  } catch (error) {
    // Fallback para ambiente local/file:// e restricoes CORS.
    await fetch(SHEET_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: true, fallback: true, confirmed: true, warning: error?.message || "" };
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
        ? "E necessario aceitar o termo antes de avancar."
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

continueBtn.addEventListener("click", async () => {
  if (!consentAccepted) return;
  try {
    if (!consentLogged) {
      const result = await sendToSheet(getConsentPayload());
      consentLogged = Boolean(result.confirmed);
      if (!result.confirmed) {
        setFeedback(currentLanguage === "pt"
          ? `Consentimento sem confirmacao. Detalhe: ${result.error || "sem resposta do Apps Script"}.`
          : `Consent submitted without confirmation. Detail: ${result.error || "no Apps Script response"}.`);
      }
    }
  } catch (_error) {
    setFeedback(currentLanguage === "pt"
      ? "Nao foi possivel confirmar envio agora. Voce pode continuar e enviar ao final."
      : "Could not confirm submission now. You can continue and submit at the end.");
  }
  if (!feedback.textContent) clearFeedback();
  setActiveTab("observation");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback();

  if (!consentAccepted) {
    setActiveTab("consent");
    setFeedback("Aceite o termo de consentimento para enviar a observacao.");
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
    setFeedback("Preencha os campos obrigatorios: nome, e-mail, data, local e foto.");
    return;
  }

  try {
    const payload = await getObservationPayload();
    const result = await sendToSheet(payload);
    form.reset();
    if (!SHEET_ENDPOINT) {
      setFeedback("Observacao validada. Configure window.RAJA_CONFIG.sheetEndpoint em config.js.");
    } else if (result.confirmed) {
      setFeedback("Sua observação foi salva", true);
    } else {
      setFeedback(currentLanguage === "pt"
        ? `Envio sem confirmacao. Detalhe: ${result.error || "sem resposta do Apps Script"}.`
        : `Submission without confirmation. Detail: ${result.error || "no Apps Script response"}.`);
    }
  } catch (error) {
    setFeedback(error.message);
  }
});

setLanguage("pt");
setActiveTab("consent");

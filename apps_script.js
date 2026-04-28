// ============================================================
// Marzban Docs Service - Apps Script
// https://github.com/YOUR_USERNAME/marzban-docs-sync
// ============================================================
// KURULUM:
// 1. script.google.com → Yeni proje
// 2. Bu kodu yapıştır → Kaydet
// 3. Deploy → New Deployment → Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 4. URL'yi VPS install.sh'a yapıştır
// ============================================================

const CONFIG = {
  SECRET: "marzban-secret-2024"  // VPS ile aynı olmalı
};

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return json({ ok: false, error: "No body" });
    }

    const data = JSON.parse(e.postData.contents);

    if (data.secret !== CONFIG.SECRET) {
      return json({ ok: false, error: "Unauthorized" });
    }

    const action = data.action;
    const username = data.username || "user";

    Logger.log("Action: " + action + " | User: " + username);

    if (action === "create") {
      const docId = createDoc(username, data.content || "");
      if (!docId) return json({ ok: false, error: "Doc create failed" });

      const link = "https://doc.google.com/document/d/" + docId + "/export?format=txt";
      return json({ ok: true, doc_id: docId, doc_link: link });
    }

    if (action === "update") {
      const ok = updateDoc(data.doc_id, data.content || "");
      return json({ ok: ok });
    }

    if (action === "delete") {
      const ok = deleteDoc(data.doc_id);
      return json({ ok: ok });
    }

    return json({ ok: false, error: "Unknown action: " + action });

  } catch (err) {
    Logger.log("doPost error: " + err);
    return json({ ok: false, error: err.toString() });
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput("Marzban Docs Service - OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

function createDoc(username, content) {
  try {
    // username şu formatta gelir: vps1_Seyit
    // Dosya adı sadece "Seyit" olur (Hiddify'da temiz görünmesi için)
    const parts = username.split("_");
    let realName;
    if (parts.length > 1) {
      realName = parts.slice(1).join("_");
    } else {
      realName = username;
    }
    const cleanName = realName.replace(/[^a-zA-Z0-9._-]/g, "_");

    const doc = DocumentApp.create(cleanName);
    const body = doc.getBody();
    body.setText(content);
    doc.saveAndClose();

    const file = DriveApp.getFileById(doc.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return doc.getId();
  } catch (err) {
    Logger.log("createDoc error: " + err);
    return null;
  }
}

function updateDoc(docId, content) {
  try {
    if (!docId) return false;
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    body.clear();
    body.setText(content);
    doc.saveAndClose();
    return true;
  } catch (err) {
    Logger.log("updateDoc error: " + err);
    return false;
  }
}

function deleteDoc(docId) {
  try {
    if (!docId) return false;
    DriveApp.getFileById(docId).setTrashed(true);
    return true;
  } catch (err) {
    Logger.log("deleteDoc error: " + err);
    return false;
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

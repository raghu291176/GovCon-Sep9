// Minimal Microsoft Graph + MSAL helpers (browser)

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class MicrosoftClient {
  constructor({ clientId, authority, redirectUri } = {}) {
    this.clientId = clientId;
    this.authority = authority || 'https://login.microsoftonline.com/common';
    this.redirectUri = redirectUri || (typeof window !== 'undefined' ? window.location.origin : undefined);
    this.scopes = ['User.Read', 'Files.Read', 'offline_access', 'openid', 'profile'];
    this.account = null;
    this.app = null;
  }

  init() {
    const msal = window.msal || window.msalPublic || window.msalPublicClient || null;
    if (!msal || !window.msal) throw new Error('MSAL browser library not loaded');
    this.app = new window.msal.PublicClientApplication({
      auth: { clientId: this.clientId, authority: this.authority, redirectUri: this.redirectUri },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
    });
    const accs = this.app.getAllAccounts();
    if (accs && accs.length) this.account = accs[0];
  }

  async login() {
    if (!this.app) this.init();
    const result = await this.app.loginPopup({ scopes: this.scopes });
    this.account = result.account;
    return this.account;
  }

  async logout() {
    if (!this.app) return;
    await this.app.logoutPopup();
    this.account = null;
  }

  async token(scopes = this.scopes) {
    if (!this.app) this.init();
    const request = { scopes, account: this.account || this.app.getAllAccounts()[0] };
    try {
      const r = await this.app.acquireTokenSilent(request);
      return r.accessToken;
    } catch (_) {
      const r = await this.app.acquireTokenPopup(request);
      return r.accessToken;
    }
  }

  async gget(path) {
    const at = await this.token();
    const res = await fetch(`${GRAPH_BASE}${path}`, { headers: { Authorization: `Bearer ${at}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(t || `Graph GET failed (${res.status})`);
    }
    return res.json();
  }

  async searchExcel(query) {
    const q = encodeURIComponent(query || '.xlsx');
    const data = await this.gget(`/me/drive/root/search(q='${q}')?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.xlsx?$/.test(String(x.name || '')));
    return items;
  }

  async searchAll(query) {
    const q = encodeURIComponent(query || '');
    const data = await this.gget(`/me/drive/root/search(q='${q}')?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.(xlsx?|pdf|png|jpg|jpeg|docx)$/i.test(String(x.name || '')));
    return items;
  }

  async listRecentAll() {
    const data = await this.gget(`/me/drive/recent?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.(xlsx?|pdf|png|jpg|jpeg|docx)$/i.test(String(x.name || '')));
    return items;
  }

  async listChildren(folderId = null) {
    const path = folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : `/me/drive/root/children`;
    const data = await this.gget(`${path}?$select=id,name,webUrl,parentReference,folder,file`);
    return data.value || [];
  }

  async listFolderFiles(folderId, recursive = false) {
    const out = [];
    const stack = [folderId || null];
    while (stack.length) {
      const id = stack.pop();
      const children = await this.listChildren(id);
      for (const it of children) {
        if (it.folder) {
          if (recursive) stack.push(it.id);
        } else if (it.file && /\.(xlsx?|pdf|png|jpg|jpeg|docx)$/i.test(String(it.name || ''))) {
          out.push(it);
        }
      }
      if (!recursive) break;
    }
    return out;
  }

  async searchDocs(query) {
    const q = encodeURIComponent(query || '');
    const data = await this.gget(`/me/drive/root/search(q='${q}')?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.(pdf|png|jpg|jpeg|docx)$/i.test(String(x.name || '')));
    return items;
  }

  async listRecentDocs() {
    const data = await this.gget(`/me/drive/recent?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.(pdf|png|jpg|jpeg|docx)$/i.test(String(x.name || '')));
    return items;
  }

  async downloadItemAsFile(item) {
    const driveId = item?.parentReference?.driveId;
    const itemId = item?.id;
    if (!driveId || !itemId) throw new Error('Missing drive or item id');
    const at = await this.token();
    const resp = await fetch(`${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(t || `Graph download failed (${resp.status})`);
    }
    const blob = await resp.blob();
    const name = item?.name || 'file';
    const type = blob.type || 'application/octet-stream';
    return new File([blob], name, { type });
  }

  async listRecent() {
    const data = await this.gget(`/me/drive/recent?$select=id,name,webUrl,parentReference,file`);
    const items = (data.value || []).filter(x => x.file && /\.xlsx?$/.test(String(x.name || '')));
    return items;
  }

  async fetchWorkbookAOA(item) {
    const driveId = item?.parentReference?.driveId;
    const itemId = item?.id;
    if (!driveId || !itemId) throw new Error('Missing drive or item id');
    const ws = await this.gget(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets`);
    const first = (ws.value || [])[0];
    if (!first) throw new Error('Workbook has no worksheets');
    const used = await this.gget(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/worksheets/${encodeURIComponent(first.id)}/usedRange(valuesOnly=true)?$select=values,address`);
    const values = used?.values || [];
    // Ensure 2D array of strings/numbers
    return values.map(row => (Array.isArray(row) ? row : []));
  }
}

import { useCallback, useEffect, useState } from "react";
import { TAGS, TAG_LABELS, describeAllowEntry, normalizeDomainInput, parseAllowUrl, type Tag } from "@core";
import { api, type SitesView } from "../api";
import { ErrorBanner, useSubmit } from "../components/Confirm";
import { useRefresh } from "./MainApp";

const SUGGESTIONS = ["youtube.com", "facebook.com", "tiktok.com", "instagram.com", "x.com", "reddit.com", "netflix.com", "twitch.tv"];

export function SitesPage() {
  const tick = useRefresh();
  const [view, setView] = useState<SitesView | null>(null);
  const [domain, setDomain] = useState("");
  const [domainTag, setDomainTag] = useState<Tag>("entertainment");
  const [link, setLink] = useState("");
  const reload = useCallback(() => void api.listSites().then(setView), []);
  const { submit, error, setError, dialog } = useSubmit(reload);

  useEffect(reload, [tick, reload]);

  function setSite(pattern: string, tag: Tag | null) {
    const action = tag ? `Đổi ${pattern} sang tag ${TAG_LABELS[tag]}.` : `Gỡ ${pattern}: trang này sẽ không bị chặn nữa.`;
    void submit(action, (confirmed) => api.setSiteTag(pattern, tag, confirmed));
  }

  const existing = new Set(view?.domainRules.map((r) => r.pattern));

  return (
    <div className="page">
      <h1>Trang web</h1>
      <p className="muted" style={{ margin: 0 }}>
        Extension Edge chặn các trang này trước khi tải. Danh sách dùng chung với extension khi extension đã nối với agent.
      </p>
      <ErrorBanner error={error} />

      <section className="card">
        <h2>Tên miền</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const pattern = normalizeDomainInput(domain);
            if (!pattern) {
              setError("Tên miền không hợp lệ.");
              return;
            }
            setSite(pattern, domainTag);
            setDomain("");
          }}
        >
          <input type="text" placeholder="vd: instagram.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <select value={domainTag} onChange={(e) => setDomainTag(e.target.value as Tag)} aria-label="Tag">
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABELS[t]}
              </option>
            ))}
          </select>
          <button className="btn-primary" type="submit">
            Thêm
          </button>
        </form>
        <div className="suggestions">
          {SUGGESTIONS.filter((s) => !existing.has(s)).map((s) => (
            <button key={s} className="btn-secondary" onClick={() => setSite(s, "entertainment")}>
              + {s}
            </button>
          ))}
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>Tên miền</th>
              <th>Tag</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view?.domainRules.map((r) => (
              <tr key={r.pattern}>
                <td>{r.pattern}</td>
                <td>
                  <select value={r.tag} aria-label={`Tag của ${r.pattern}`} onChange={(e) => setSite(r.pattern, e.target.value as Tag)}>
                    {TAGS.map((t) => (
                      <option key={t} value={t}>
                        {TAG_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="actions">
                  <button className="btn-quiet small-btn" onClick={() => setSite(r.pattern, null)}>
                    Gỡ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Link được phép</h2>
        <p className="muted">
          Video hoặc playlist YouTube (hay một đường dẫn cụ thể) dùng để học thì không bị chặn. Thêm link cần xác nhận, kể
          cả trong giờ học.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const entry = parseAllowUrl(link);
            if (!entry) {
              setError("Link không dùng được: chỉ nhận video hoặc playlist YouTube, hoặc một đường dẫn cụ thể (không phải cả trang).");
              return;
            }
            void submit("Thêm link được phép: mở link này sẽ không hiện cảnh báo.", (confirmed) => api.addAllowUrl(entry, confirmed));
            setLink("");
          }}
        >
          <input type="text" placeholder="Dán link video hoặc playlist" value={link} onChange={(e) => setLink(e.target.value)} />
          <button className="btn-primary" type="submit">
            Thêm
          </button>
        </form>
        <table className="list">
          <tbody>
            {view && view.allowUrls.length === 0 && (
              <tr>
                <td className="faint">Chưa có link nào.</td>
              </tr>
            )}
            {view?.allowUrls.map((entry) => (
              <tr key={describeAllowEntry(entry)}>
                <td>{describeAllowEntry(entry)}</td>
                <td className="actions">
                  <button className="btn-quiet small-btn" onClick={() => void submit("Gỡ link được phép.", () => api.removeAllowUrl(entry))}>
                    Gỡ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {dialog}
    </div>
  );
}

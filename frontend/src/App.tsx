import { useCallback, useEffect, useRef, useState } from "react";
import { getTaskStatus, uploadFridgePhoto } from "./api";
import "./App.css";

type Phase = "idle" | "uploading" | "polling" | "done";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "排队中",
    STARTED: "处理中",
    SUCCESS: "已完成",
    FAILURE: "失败",
    RETRY: "重试中",
    REVOKED: "已取消",
  };
  return map[status] ?? status;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [celeryStatus, setCeleryStatus] = useState<string>("");
  const [result, setResult] = useState<unknown>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, stopPolling]);

  const onPickFile = (f: File | null) => {
    setError(null);
    setResult(null);
    setTaskId(null);
    setCeleryStatus("");
    setPhase("idle");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);

    if (!f || !f.type.startsWith("image/")) {
      if (f) setError("请选择图片文件（JPEG / PNG / WebP 等）。");
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const runPipeline = async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    setPhase("uploading");

    let id: string;
    try {
      const up = await uploadFridgePhoto(file);
      id = up.task_id;
      setTaskId(id);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "上传失败");
      return;
    }

    setPhase("polling");
    const started = Date.now();
    const timeoutMs = 6 * 60 * 1000;

    const tick = async () => {
      if (Date.now() - started > timeoutMs) {
        stopPolling();
        setPhase("idle");
        setError("等待超时，请稍后重试或检查后端与 Worker 是否正常运行。");
        return;
      }

      try {
        const t = await getTaskStatus(id);
        setCeleryStatus(t.status);

        if (t.status === "SUCCESS") {
          stopPolling();
          setResult(t.result);
          setPhase("done");
          return;
        }

        if (t.status === "FAILURE") {
          stopPolling();
          setResult(t.result);
          setPhase("done");
        }
      } catch (e) {
        stopPolling();
        setPhase("idle");
        setError(e instanceof Error ? e.message : "轮询失败");
      }
    };

    await tick();
    pollTimer.current = setInterval(() => {
      void tick();
    }, 2000);
  };

  const reset = () => {
    stopPolling();
    setPhase("idle");
    setError(null);
    setResult(null);
    setTaskId(null);
    setCeleryStatus("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
  };

  const renderResult = () => {
    if (phase !== "done" || result === null) return null;

    if (typeof result === "string") {
      return (
        <section className="card card-error">
          <h2>任务异常</h2>
          <pre className="mono">{result}</pre>
        </section>
      );
    }

    if (isRecord(result) && typeof result.error === "string") {
      return (
        <section className="card card-error">
          <h2>无法生成菜谱</h2>
          <p>{result.error}</p>
        </section>
      );
    }

    if (isRecord(result)) {
      const best = typeof result.best_match === "string" ? result.best_match : "推荐菜谱";
      const instructions =
        typeof result.instructions === "string" ? result.instructions : "";
      const subs = result.substitutions;
      const shop = result.shopping_list;

      return (
        <section className="card card-success">
          <h2>{best}</h2>
          {instructions ? (
            <div className="block">
              <h3>步骤</h3>
              <p className="instructions">{instructions}</p>
            </div>
          ) : null}
          {isRecord(subs) && Object.keys(subs).length > 0 ? (
            <div className="block">
              <h3>替代建议</h3>
              <ul className="kv-list">
                {Object.entries(subs).map(([k, v]) => (
                  <li key={k}>
                    <span className="k">{k}</span>
                    <span className="arrow">→</span>
                    <span className="v">{String(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {Array.isArray(shop) && shop.length > 0 ? (
            <div className="block">
              <h3>建议采购</h3>
              <ul className="pill-list">
                {shop.map((item, i) => (
                  <li key={i} className="pill">
                    {String(item)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="raw">
            <summary>原始 JSON</summary>
            <pre className="mono">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </section>
      );
    }

    return (
      <section className="card">
        <h2>返回数据</h2>
        <pre className="mono">{JSON.stringify(result, null, 2)}</pre>
      </section>
    );
  };

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">FridgeAI</p>
        <h1>拍一张冰箱照片，生成可做菜谱</h1>
        <p className="lede">
          上传图片后，后端会识别食材、在向量库中匹配相似菜谱，并用大模型整理成步骤与采购建议。
        </p>
      </header>

      <main className="layout">
        <section className="card panel">
          <div
            className="dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              onPickFile(e.dataTransfer.files[0] ?? null);
            }}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="预览" className="preview" />
            ) : (
              <div className="dropzone-inner">
                <p>拖拽图片到此处，或点击下方选择文件</p>
              </div>
            )}
          </div>

          <div className="actions">
            <label className="btn secondary">
              选择图片
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={!file || phase === "uploading" || phase === "polling"}
              onClick={() => void runPipeline()}
            >
              {phase === "uploading" ? "上传中…" : phase === "polling" ? "分析中…" : "开始分析"}
            </button>
            {(file || phase !== "idle") && (
              <button type="button" className="btn ghost" onClick={reset}>
                重置
              </button>
            )}
          </div>

          {phase === "polling" || phase === "uploading" ? (
            <p className="hint">
              {phase === "uploading" ? "正在上传…" : `任务状态：${formatStatusLabel(celeryStatus) || "…"}`}
              {taskId ? (
                <>
                  <br />
                  <span className="mono subtle">task_id: {taskId}</span>
                </>
              ) : null}
            </p>
          ) : null}

          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : null}
        </section>

        {renderResult()}
      </main>

      <footer className="footer">
        <span>
          默认 API：<code className="mono">{import.meta.env.VITE_API_URL ?? "http://localhost:8000"}</code>
        </span>
        <span> · 可通过环境变量 <code className="mono">VITE_API_URL</code> 覆盖</span>
      </footer>
    </div>
  );
}

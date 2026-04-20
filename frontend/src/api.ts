const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type TaskStatusResponse = {
  task_id: string;
  status: string;
  result: unknown;
};

export type UploadResponse = {
  task_id: string;
  status: string;
};

export async function uploadFridgePhoto(file: File): Promise<UploadResponse> {
  const body = new FormData();
  body.append("file", file);

  const res = await fetch(`${API_URL}/upload-fridge`, {
    method: "POST",
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `上传失败（HTTP ${res.status}）`);
  }

  return (await res.json()) as UploadResponse;
}

export async function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
  const res = await fetch(`${API_URL}/tasks/${encodeURIComponent(taskId)}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `查询任务失败（HTTP ${res.status}）`);
  }

  return (await res.json()) as TaskStatusResponse;
}

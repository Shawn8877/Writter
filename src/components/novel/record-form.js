"use client";

import { useContext, useState } from "react";
import { Save } from "lucide-react";
import { Field, Modal } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { NovelContext } from "./novel-context";

export function RecordForm({ title, fields, record = {}, onSave, onClose }) {
  const context = useContext(NovelContext);
  const [baseRevision] = useState(context?.novel.revision);
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        record[field.key] ?? field.defaultValue ?? "",
      ]),
    ),
  );
  const { notify } = useStudio();
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    try {
      if (context && context.novel.revision !== baseRevision) {
        throw new Error("小说内容在编辑期间发生了变化。当前输入已保留，请先复制修改，再关闭弹窗并重新打开核对后保存。");
      }
      const clean = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          typeof value === "string" ? value.trim() : value,
        ]),
      );
      const invalid = fields.find(
        (field) => field.required && !clean[field.key],
      );
      if (invalid) {
        notify(`请填写${invalid.label}`, "error");
        return;
      }
      setSaving(true);
      await onSave(clean);
      notify("已保存到云端。", "success");
      onClose();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={title} onClose={() => { if (!saving) onClose(); }}>
      <form onSubmit={submit} className="record-form">
        {fields.map((field) => (
          <Field
            key={field.key}
            label={
              <>
                {field.label}
                {field.required && <span className="required"> *</span>}
              </>
            }
            htmlFor={`record-${field.key}`}
            hint={field.hint}
          >
            {field.type === "textarea" ? (
              <textarea
                disabled={saving}
                id={`record-${field.key}`}
                rows={field.rows || 4}
                value={values[field.key]}
                required={field.required}
                maxLength={field.maxLength || 10000}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              />
            ) : field.options ? (
              <select
                disabled={saving}
                id={`record-${field.key}`}
                value={values[field.key]}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              >
                {field.options.map((option) => (
                  <option key={typeof option === "string" ? option : option.value} value={typeof option === "string" ? option : option.value}>{typeof option === "string" ? option : option.label}</option>
                ))}
              </select>
            ) : (
              <input
                disabled={saving}
                id={`record-${field.key}`}
                value={values[field.key]}
                required={field.required}
                maxLength={field.maxLength || 200}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.value })
                }
              />
            )}
          </Field>
        ))}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-ghost"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            <Save size={15} />
            {saving ? "正在保存…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

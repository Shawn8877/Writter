"use client";
import { useEffect } from "react";

export function useUnsavedChanges(dirty, message = "章节有尚未同步到云端的修改。临时草稿会保留在当前浏览器；确定离开吗？") {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeLink = (event) => {
      const link = event.target instanceof Element
        ? event.target.closest("a[href]") : null;
      if (
        !link ||
        link.target === "_blank" ||
        link.href === window.location.href
      )
        return;
      if (
        !window.confirm(
          message,
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [dirty, message]);
}

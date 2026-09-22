"use client";
import { createContext, useContext } from "react";

export const NovelContext = createContext(null);
export function useNovel() {
  const context = useContext(NovelContext);
  if (!context) throw new Error("Novel workspace context is missing");
  return context;
}

import * as React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { App as ClassicUI } from "./App";
import { ModernUI } from "./modern/ModernUI";

export function Router() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0B1221] text-gray-100">
        <Routes>
          <Route path="/classic" element={<ClassicUI />} />
          <Route path="/modern" element={<ModernUI />} />
          <Route path="/" element={<Navigate to="/modern" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

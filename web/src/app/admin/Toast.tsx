"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";

interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (text: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback(
    (text: string, type: "success" | "error" | "info" = "success") => {
      const id = ++toastId;
      setMessages((prev) => [...prev, { id, text, type }]);
    },
    []
  );

  const remove = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {messages.map((msg) => (
          <ToastItem key={msg.id} message={msg} onDone={() => remove(msg.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  message,
  onDone,
}: {
  message: ToastMessage;
  onDone: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 200);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  const bgColor =
    message.type === "success"
      ? "bg-green-600"
      : message.type === "error"
      ? "bg-red-600"
      : "bg-blue-600";

  return (
    <div
      className={`${bgColor} text-white text-sm px-4 py-3 rounded-lg shadow-lg transition-all duration-200 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {message.text}
    </div>
  );
}

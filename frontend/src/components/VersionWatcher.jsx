import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

/**
 * Watches the backend's build hash every 60s. If it changes vs. the first
 * loaded version, shows a persistent toast asking the user to reload.
 */
export default function VersionWatcher() {
  const initialBuild = useRef(null);
  const toastShown = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { data } = await api.get("/system/version");
        const current = data.build;
        if (!initialBuild.current) {
          initialBuild.current = current;
          return;
        }
        if (current && current !== initialBuild.current && !toastShown.current) {
          toastShown.current = true;
          toast.success("Nova versão detectada", {
            description: "Uma atualização foi aplicada. Clique para recarregar.",
            duration: Infinity,
            action: {
              label: "Recarregar",
              onClick: () => window.location.reload(true),
            },
            icon: <RefreshCw size={16} />,
          });
          setTick((t) => t + 1);
        }
      } catch (e) {
        // ignore (backend pode estar reiniciando)
      }
    }
    check();
    const id = setInterval(() => { if (!cancelled) check(); }, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return null;
}

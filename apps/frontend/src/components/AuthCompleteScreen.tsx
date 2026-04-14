import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

export default function AuthCompleteScreen() {
  useEffect(() => {
    const closeTimer = window.setTimeout(() => {
      window.close();
    }, 500);

    return () => {
      window.clearTimeout(closeTimer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground border border-border p-8 rounded-lg w-full max-w-md shadow-2xl text-center">
        <div className="flex items-center justify-center mb-6">
          <div className="bg-primary/10 p-3 rounded-full">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-2">Plex sign-in finished</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Return to your original Cliparr tab. You can close this one if it stays open.
        </p>
        <button
          type="button"
          onClick={() => window.close()}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 rounded-lg transition-colors"
        >
          Close this tab
        </button>
      </div>
    </div>
  );
}

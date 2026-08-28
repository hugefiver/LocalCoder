import { AppProviders } from "@/app/AppProviders";
import { AppRoutes } from "@/app/routes";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <AppProviders>
      <AppRoutes />
      <Toaster position="bottom-right" />
    </AppProviders>
  );
}

export default App;

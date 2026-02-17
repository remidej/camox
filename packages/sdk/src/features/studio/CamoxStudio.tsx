import * as React from "react";
import { Navbar } from "./components/Navbar";

interface CamoxStudioProps {
  children: React.ReactNode;
}

const CamoxStudio = ({ children }: CamoxStudioProps) => {
  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <Navbar />
      {children}
    </div>
  );
};

export { CamoxStudio };

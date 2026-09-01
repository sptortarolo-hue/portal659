import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export default function VerificadoPage() {
  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center text-center">
        <Logo markClassName="h-14 w-14 text-primary" />
        <div className="mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-semibold mt-4">Tu correo fue verificado</h1>
        <p className="text-muted-foreground mt-2">
          Ya podés iniciar sesión y administrar tu comercio y tus pedidos.
        </p>
        <Button asChild className="w-full mt-8">
          <Link href="/login">Ir a iniciar sesión</Link>
        </Button>
      </div>
    </main>
  );
}
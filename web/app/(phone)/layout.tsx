import { MomentProvider } from "@/components/app/moments";

/**
 * The app shell (FR-UX-1, FR-UX-7): full screen on a phone; on a laptop, a phone frame on the mint sky.
 * Everything that slides or plays sits inside #phone-root, so it stays inside the phone.
 */
export default function PhoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh items-center justify-center min-[601px]:gap-20" style={{ backgroundImage: "url(/sky/laptop.svg)", backgroundSize: "cover", backgroundPosition: "center bottom" }}>
      <div className="hidden max-w-[340px] min-[1000px]:block">
        <p className="font-serif text-[76px] font-bold leading-[80px]">Kitty</p>
        <p className="mt-4 text-[22px] leading-[30px]">Plan, pay and save with friends, without anyone fronting money, chasing debts or overspending.</p>
        <p className="mt-4 text-[13px] font-extrabold uppercase tracking-wider">Every friend has their own kitten</p>
      </div>
      <div id="phone-root" className="relative h-dvh w-full overflow-hidden bg-paper min-[601px]:h-[844px] min-[601px]:max-h-[96dvh] min-[601px]:w-[390px] min-[601px]:rounded-[44px] min-[601px]:shadow-[0_0_0_10px_#16112c,0_30px_60px_rgba(22,17,44,0.35)]">
        <MomentProvider>{children}</MomentProvider>
      </div>
    </div>
  );
}

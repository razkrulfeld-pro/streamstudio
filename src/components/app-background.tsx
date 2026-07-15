export function AppBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white"
    >
      <div className="absolute bottom-0 left-0 size-[560px] -translate-x-1/2 translate-y-1/2 rounded-full bg-[#5234d2] opacity-[0.55] blur-[110px]" />
    </div>
  )
}

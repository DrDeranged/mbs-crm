import * as React from "react"
import { isMobileWeb } from "@/lib/recordContact"

const MOBILE_BREAKPOINT = 768

/** Contact-action layout also treats landscape phones and touch tablets as mobile. */
export function useIsMobileWeb() {
  const detect = () => typeof window !== "undefined" && isMobileWeb({
    userAgent: navigator.userAgent,
    viewportWidth: window.innerWidth,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
  })
  const [mobile, setMobile] = React.useState(detect)
  React.useEffect(() => {
    const update = () => setMobile(detect())
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return mobile
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

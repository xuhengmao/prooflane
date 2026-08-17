import type { PropsWithChildren, ReactElement } from "react"
import { render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import zhCNMessages from "@/i18n/messages/zh-CN.json"

function RelayIntlProvider({ children }: PropsWithChildren) {
  return (
    <NextIntlClientProvider locale="zh-CN" messages={zhCNMessages}>
      {children}
    </NextIntlClientProvider>
  )
}

export function renderWithRelayIntl(ui: ReactElement) {
  return render(ui, { wrapper: RelayIntlProvider })
}

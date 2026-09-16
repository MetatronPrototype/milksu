import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'

export default function UpdateInstallDialog({
  open,
  onOpenChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onConfirm?: () => void
  onCancel?: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={next => {
      onOpenChange?.(next)
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('退出并更新？', 'Quit and update?')}</DialogTitle>
        <DialogDescription>
          {t(
            '有任务正在运行，现在重启会中断当前回合。退出并更新？',
            'A task is running. Restarting will interrupt this turn. Quit and update?',
          )}
        </DialogDescription>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('取消', 'Cancel')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t('退出并更新', 'Quit and update')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

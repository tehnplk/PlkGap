import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

/**
 * Shown when a menu is used while signed out. It only points at the account button in the sidebar
 * footer — signing in stays one place, so there is never a second login path to keep in step.
 */
export function LoginRequiredDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return <dialog className="login-modal" aria-label="ต้องเข้าสู่ระบบก่อน" ref={dialog} onClose={onClose}
    onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    <header>
      <div>
        <strong>ต้องเข้าสู่ระบบก่อนใช้งาน</strong>
        <small>เมนูทั้งหมดเปิดได้เมื่อเข้าสู่ระบบแล้ว</small>
      </div>
      <button type="button" className="modal-close" aria-label="ปิด" title="ปิด" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </header>
    <div className="login-modal-body">
      <p>กรุณาคลิกปุ่ม <strong>เข้าสู่ระบบ</strong> ที่มุมซ้ายล่างของหน้าจอ ในแถบเมนูด้านซ้าย</p>
      <p className="login-modal-hint"><Icon name="chevron" size={14} /> ปุ่มอยู่ใต้รายการเมนูทั้งหมด</p>
      <button type="button" className="mock-button primary" onClick={onClose}>รับทราบ</button>
    </div>
  </dialog>
}

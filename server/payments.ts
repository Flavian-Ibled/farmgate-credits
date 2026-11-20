// Payment layer. Today only "bank transfer on invoice" is active: Carbone Farmers confirms receipt in the admin.
// An online provider (card, SEPA direct debit…) plugs in here later: implement `start` (redirect to the provider's
// hosted page) and the webhook that calls `confirmPayment`. Nothing here moves money or stores card data.
export interface PaymentInstructions { method: string; reference: string; amount_eur: number; due_date: string; bank: { holder: string | null; iban: string | null; bic: string | null }; note: string }
export interface PaymentProvider { id: string; label_fr: string; label_en: string; enabled: boolean; start(o: { reference: string; amount_eur: number; expires_at: string }): Promise<{ instructions?: PaymentInstructions; redirect_url?: string }> }

const env = (k: string) => (process.env[k] ?? '').trim() || null;
export const PROVIDERS: Record<string, PaymentProvider> = {
  transfer: {
    id: 'transfer', label_fr: 'Virement bancaire sur facture', label_en: 'Bank transfer on invoice', enabled: true,
    async start(o) {
      // bank details come from the server configuration only; never invented
      return { instructions: { method: 'transfer', reference: o.reference, amount_eur: o.amount_eur, due_date: o.expires_at.slice(0, 10), bank: { holder: env('FG_BANK_HOLDER'), iban: env('FG_BANK_IBAN'), bic: env('FG_BANK_BIC') },
        note: 'Indiquez la référence de commande dans le libellé du virement. Les crédits sont réservés jusqu’à la date limite ; ils sont attribués à réception du paiement.' } };
    },
  },
  online: {
    id: 'online', label_fr: 'Paiement en ligne (carte, prélèvement)', label_en: 'Online payment (card, direct debit)', enabled: false,
    async start() { throw Object.assign(new Error('Le paiement en ligne n’est pas encore branché'), { status: 501 }); },
  },
};
export const enabledProviders = () => Object.values(PROVIDERS).map(p => ({ id: p.id, label_fr: p.label_fr, label_en: p.label_en, enabled: p.enabled }));

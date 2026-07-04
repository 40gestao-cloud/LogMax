import React from 'react';
import { useFilial } from '../contexts/FilialContext';
import { GenericCRUDView } from './GenericCRUDView';

const FIELDS = [
  { key: 'codigo',  label: 'Código',       required: true, placeholder: 'Ex: SRV-001' },
  { key: 'nome',    label: 'Nome',          required: true, placeholder: 'Ex: Instalação' },
  { key: 'tipo',    label: 'Tipo',          placeholder: 'Ex: Manutenção' },
  { key: 'valor',   label: 'Valor (R$)',    type: 'currency' as const, placeholder: '0,00' },
  { key: 'status',  label: 'Status',        type: 'select' as const, options: ['Ativo', 'Inativo'] },
];

export const ServicosView = ({ showToast }: { showToast: any }) => {
  const { filialAtiva } = useFilial();

  if (!filialAtiva) return null;

  return (
    <GenericCRUDView
      showToast={showToast}
      title={`Serviços — ${filialAtiva}`}
      subtitle="Gerencie os serviços prestados."
      endpoint="/api/servicosview"
      fields={FIELDS}
      filialLocked={filialAtiva}
      onTrocarFilial={() => {}}
    />
  );
};

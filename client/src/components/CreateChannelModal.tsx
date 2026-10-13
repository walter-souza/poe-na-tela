import React, { useState } from 'react';
import { Hash, Volume2 } from 'lucide-react';
import { Button, ErrorText, Field, Modal, Segmented, inputClass } from './ui';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl } from '../utils/api';
import type { Channel } from '../types';

interface CreateChannelModalProps {
  isOpen: boolean;
  roomSlug: string;
  onClose: () => void;
  onChannelCreated: (newChannel: Channel) => void;
}

const TYPE_OPTIONS: { value: 'text' | 'voice'; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'voice', label: 'Voz' },
];

/** Criar canal de texto ou de voz no servidor atual. */
export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({ isOpen, roomSlug, onClose, onChannelCreated }) => {
  const { session } = useAuth();
  const [channelType, setChannelType] = useState<'text' | 'voice'>('text');
  const [channelName, setChannelName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = channelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    if (!cleanName) {
      setError('Dê um nome ao canal.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const token = session?.access_token;
      const res = await fetch(`${getApiBaseUrl()}/api/rooms/${roomSlug}/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: cleanName, type: channelType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar o canal.');

      onChannelCreated(data.channel);
      onClose();
      setChannelName('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar o canal.');
    } finally {
      setIsLoading(false);
    }
  };

  const Icon = channelType === 'text' ? Hash : Volume2;

  return (
    <Modal open={isOpen} onClose={onClose} title="Criar canal" className="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-400">Tipo</p>
          <Segmented ariaLabel="Tipo do canal" options={TYPE_OPTIONS} value={channelType} onChange={setChannelType} />
          <p className="text-xs text-gray-500">
            {channelType === 'text' ? 'Para mensagens e links.' : 'Para conversar por voz e transmitir a tela.'}
          </p>
        </div>

        <Field label="Nome" htmlFor="channel-name">
          <div className="relative">
            <Icon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="channel-name"
              autoFocus
              type="text"
              maxLength={32}
              value={channelName}
              onChange={(e) =>
                setChannelName(
                  e.target.value
                    .toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9_-]/g, '')
                )
              }
              placeholder={channelType === 'text' ? 'bate-papo' : 'squad-alfa'}
              className={`${inputClass} pl-9`}
            />
          </div>
        </Field>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isLoading || !channelName.trim()}>
            {isLoading ? 'Criando' : 'Criar canal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

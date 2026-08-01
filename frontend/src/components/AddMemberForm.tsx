import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface AddMemberFormProps {
  onAdd: (name: string, email: string, password: string, role: string) => void;
  // Roles the current user is allowed to assign to a new member. The
  // backend enforces this too (a Manager can't create an Admin/Manager),
  // but hiding the disallowed options here keeps the UI honest and avoids
  // a confusing 403 after filling out the whole form.
  assignableRoles: string[];
}

export default function AddMemberForm({ onAdd, assignableRoles }: AddMemberFormProps) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState(assignableRoles.includes('Staff') ? 'Staff' : assignableRoles[0] || 'Staff');

  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="text-sm font-medium mb-3">Add team member</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="px-3 py-2 border rounded text-sm w-full"
          required
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="px-3 py-2 border rounded text-sm w-full"
          required
        />
        {/* Wrapped so the toggle can be positioned against the input rather
            than the grid cell, which would otherwise stretch to the row's
            height and float the icon away from the field. */}
        <div className="relative w-full">
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="pr-10 px-3 py-2 border rounded text-sm w-full"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute inset-y-0 right-1 flex items-center px-2 text-gray-500 hover:text-gray-700 focus:outline-none"
            aria-pressed={showPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-3 py-2 border rounded text-sm w-full"
        >
          {assignableRoles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <div className="sm:col-span-2 text-right mt-2">
          <button
            onClick={() => {
              if (!name.trim()) return showToast('Enter a name', 'error');
              if (!email.trim()) return showToast('Enter an email', 'error');
              if (!password || password.length < 8) {
                return showToast('Enter a password with at least 8 characters', 'error');
              }
              onAdd(name.trim(), email.trim(), password, role);
              setName('');
              setEmail('');
              setPassword('');
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition"
          >
            Add Member
          </button>
        </div>
      </div>
    </div>
  );
}
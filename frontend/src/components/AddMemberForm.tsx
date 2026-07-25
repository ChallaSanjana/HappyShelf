import { useState } from 'react';

interface AddMemberFormProps {
  onAdd: (name: string, email: string, password: string, role: string) => void;
  // Roles the current user is allowed to assign to a new member. The
  // backend enforces this too (a Manager can't create an Admin/Manager),
  // but hiding the disallowed options here keeps the UI honest and avoids
  // a confusing 403 after filling out the whole form.
  assignableRoles: string[];
}

export default function AddMemberForm({ onAdd, assignableRoles }: AddMemberFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 chars)"
          className="px-3 py-2 border rounded text-sm w-full"
          required
        />
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
              if (!name.trim()) return alert('Enter a name');
              if (!email.trim()) return alert('Enter an email');
              if (!password || password.length < 8) return alert('Enter a password with at least 8 characters');
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
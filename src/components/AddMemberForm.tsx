import React, { useState } from 'react';

export default function AddMemberForm({ onAdd }: { onAdd: (name: string, role: string, access: string) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('Staff');
  const [access, setAccess] = useState('write');

  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="text-sm font-medium mb-2">Add team member</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="px-3 py-2 border rounded col-span-2" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="px-3 py-2 border rounded">
          <option>Manager</option>
          <option>Staff</option>
          <option>Viewer</option>
        </select>
        <select value={access} onChange={(e) => setAccess(e.target.value)} className="px-3 py-2 border rounded">
          <option value="admin">Admin</option>
          <option value="write">Write</option>
          <option value="read">Read</option>
        </select>
        <div className="sm:col-span-3 text-right">
          <button
            onClick={() => {
              if (!name.trim()) return alert('Enter a name');
              onAdd(name.trim(), role, access);
              setName('');
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Add Member
          </button>
        </div>
      </div>
    </div>
  );
}

module.exports = function (h) {
	var L = require('../library.js'), E = require('../edits.js');
	h.describe('edits', function () {
		var lib=L.create(), changed=[], ctx={L:L,lib:function(){return lib;},changed:function(ids){changed=ids;},say:function(){}};
		L.upsert(lib,[{id:'a',title:'Paper Lanterns - Blue Signal',channel:'Paper Lanterns'},{id:'b',title:'Paper Lanterns - Ashes',channel:'Paper Lanterns'}],{playlistId:'p'});
		L.edit(lib,'a',{rating:5,artist:'Earlier Artist',mood:'tender',at:1});
		L.edit(lib,'b',{rating:1,work:'Earlier Work',at:1});
		h.eq(E.shared(lib,['a','b'],'work'),{mixed:true,count:2,value:null},'Bulk form distinguishes mixed values from shared empty values');
		L.editMany(lib,['a','b'],{lang:'ja'});h.eq(E.shared(lib,['a','b'],'lang'),{mixed:false,count:1,value:'ja'},'Bulk form exposes a shared value');
		var before=JSON.parse(JSON.stringify([lib.tracks.a.userEdits,lib.tracks.b.userEdits])),undo=E.keep(ctx,['a','b']);
		L.editMany(lib,['a','b'],{rating:2,artist:'Wrong Artist',at:2});
		L.edit(lib,'b',{blocked:true});
		undo();
		h.eq([lib.tracks.a.rating,lib.tracks.b.rating],[5,1],'Undo restores distinct original ratings');
		h.eq([lib.tracks.a.userEdits,lib.tracks.b.userEdits],before,'Undo restores distinct original corrections');
		h.eq(lib.tracks.a.artist,'Earlier Artist','Undo derives displayed artist again');
		h.eq(lib.tracks.b.blocked,true,'Undo preserves independent block state');
		h.ok(new Date(lib.tracks.a.stateAt).getTime()>2,'Undo stamps a fresh rating change for sync');
		h.ok(changed.indexOf('a')>=0&&changed.indexOf('b')>=0,'Undo notifies the app to save restored songs');
		var missingUndo=E.keep(ctx,['a','b']);delete lib.tracks.b;missingUndo();
		h.ok(!lib.tracks.b,'Undo does not resurrect a deleted song');
	});
};
